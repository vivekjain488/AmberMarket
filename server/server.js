const http = require("http");
const path = require("path");
const { spawn } = require("child_process");
const fs = require("fs");

const cors = require("cors");
const dotenv = require("dotenv");
const express = require("express");
const { Server } = require("socket.io");
const { ethers } = require("ethers");

dotenv.config();

const { junctions, getJunctionById } = require("./junctions");
const { getCctvCameras, getCctvBySlug } = require("./cctvData");

const PORT = Number(process.env.PORT || 3001);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";

const BASE_SEPOLIA_RPC = process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org";
const ORACLE_PRIVATE_KEY = process.env.ORACLE_PRIVATE_KEY;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const AMBER_TOKEN_ADDRESS = process.env.AMBER_TOKEN_ADDRESS;
const NAMESPACE_API_KEY = process.env.NAMESPACE_API_KEY;
const ETH_MAINNET_RPC = process.env.ETH_MAINNET_RPC || "https://ethereum-rpc.publicnode.com";
const ENS_PARENT_NAME = process.env.ENS_PARENT_NAME || "ambermarket.eth";
const ENS_REGISTRY_ADDRESS = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e";
const ENS_LABEL_REGEX = /^[a-z0-9-]{3,63}$/;

// ─── ENS Namespace Client ────────────────────────────
let ensClient = null;
if (NAMESPACE_API_KEY) {
  const { createOffchainClient } = require("@thenamespace/offchain-manager");
  ensClient = createOffchainClient({
    mode: "sepolia",
    timeout: 5000,
    // Domain-based API keys must use domainApiKeys, not defaultApiKey
    domainApiKeys: {
      [ENS_PARENT_NAME]: NAMESPACE_API_KEY,
    },
  });
  console.log("🟦 Namespace Offchain Client initialized.");
} else {
  console.warn("⚠️ NAMESPACE_API_KEY not found in .env. Real ENS claiming will be disabled.");
}

// ─── Rate limiter for ENS claims (in-memory) ────────
const ensClaimTimestamps = new Map(); // address -> lastClaimMs
const ENS_CLAIM_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

const app = express();
app.use(express.json());
app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CLIENT_ORIGIN, credentials: true },
});

const amberMarketArtifact = require("./abi/AmberMarket.abi.json");
const amberMarketAbi = Array.isArray(amberMarketArtifact)
  ? amberMarketArtifact
  : amberMarketArtifact?.abi;
const hasValidAmberMarketAbi = Array.isArray(amberMarketAbi) && amberMarketAbi.length > 0;

const amberTokenArtifact = require("./abi/AmberToken.abi.json");
const amberTokenAbi = Array.isArray(amberTokenArtifact)
  ? amberTokenArtifact
  : amberTokenArtifact?.abi;
const hasValidAmberTokenAbi = Array.isArray(amberTokenAbi) && amberTokenAbi.length > 0;

function now() {
  return Date.now();
}

function isValidAddress(addr) {
  return typeof addr === "string" && /^0x[0-9a-fA-F]{40}$/i.test(addr);
}

function normalizeEnsLabel(label) {
  return String(label || "").toLowerCase().trim();
}

function isValidEnsLabel(label) {
  return ENS_LABEL_REGEX.test(label) && !label.startsWith("-") && !label.endsWith("-");
}

/**
 * Verify subname ownership via Namespace SDK (offchain subnames).
 * Falls back to on-chain ENS registry if SDK is not available.
 */
async function verifySubnameOwnership(label, address) {
  const normalizedLabel = normalizeEnsLabel(label);
  if (!isValidEnsLabel(normalizedLabel)) {
    return { verified: false, error: "Invalid label format" };
  }
  if (!isValidAddress(address)) {
    return { verified: false, error: "Missing or invalid address" };
  }

  const fullName = `${normalizedLabel}.${ENS_PARENT_NAME}`;

  // Primary: use Namespace SDK to verify offchain subnames
  if (ensClient) {
    try {
      const subname = await ensClient.getSingleSubname(fullName);
      if (subname && subname.fullName) {
        const subnameOwner = normalizeAddress(subname.owner || "");
        const expectedOwner = normalizeAddress(address);
        return {
          verified: subnameOwner === expectedOwner,
          name: fullName,
          owner: subnameOwner || null,
        };
      }
      return { verified: false, name: fullName, owner: null };
    } catch (err) {
      // SubnameNotFoundError means it doesn't exist
      if (err.name === "SubnameNotFoundError" || err.status === 404) {
        return { verified: false, name: fullName, owner: null };
      }
      console.error(`[ENS] Namespace verify error for ${fullName}:`, err.message);
    }
  }

  // Fallback: on-chain ENS registry lookup
  try {
    const ensRegistryAbi = ["function owner(bytes32 node) view returns (address)"];
    const ensReadProvider = new ethers.JsonRpcProvider(ETH_MAINNET_RPC);
    const ensRegistry = new ethers.Contract(ENS_REGISTRY_ADDRESS, ensRegistryAbi, ensReadProvider);
    const node = ethers.namehash(fullName);
    const owner = await ensRegistry.owner(node);
    const ownerNormalized = normalizeAddress(owner);
    const expectedOwner = normalizeAddress(address);

    return {
      verified: ownerNormalized === expectedOwner && ownerNormalized !== normalizeAddress(ethers.ZeroAddress),
      name: fullName,
      owner: ownerNormalized || null,
    };
  } catch (err) {
    console.error(`[ENS] On-chain verify fallback error for ${fullName}:`, err.message);
    return { verified: false, name: fullName, error: "Verification unavailable" };
  }
}

// ─── Game Engine State Machine ───────────────────────
const EngineState = {
  IDLE: "IDLE",
  PREDICTION_OPEN: "PREDICTION_OPEN",
  PREDICTION_LOCKED: "PREDICTION_LOCKED",
  EVENT_RESOLUTION: "EVENT_RESOLUTION",
  REWARD_DISTRIBUTION: "REWARD_DISTRIBUTION",
};

const engine = {
  activeJunctionId: junctions[0]?.id || "bkc-signal-1",
  state: EngineState.IDLE,
  stateSinceMs: now(),
  marketId: null,
  lastSettlement: null,
  countdown: {
    predictionOpenMs: 0,       // Indefinite until manual start
    predictionLockMs: 0,       // 0s locking countdown (skipped)
    resolutionMs: 25_000,      // 25s car counting
    rewardMs: 5_000,           // 5s settlement display
  },
  python: { proc: null, lastCount: 0, frames: 0 },
};

// ─── Player Stats (in-memory) ────────────────────────
const playerStats = {};

function normalizeAddress(address) {
  return typeof address === "string" ? address.toLowerCase() : "";
}

function getOrCreateStats(address) {
  const key = normalizeAddress(address);
  if (!key) {
    return {
      wins: 0, losses: 0, streak: 0, maxStreak: 0,
      eloRating: 1500, totalProfit: 0, gamesPlayed: 0,
    };
  }

  if (!playerStats[key]) {
    playerStats[key] = {
      wins: 0, losses: 0, streak: 0, maxStreak: 0,
      eloRating: 1500, totalProfit: 0, gamesPlayed: 0,
    };
  }
  return playerStats[key];
}

function updateElo(address, won) {
  const s = getOrCreateStats(address);
  const K = 32;
  const E = 1 / (1 + Math.pow(10, (1500 - s.eloRating) / 400));
  const S = won ? 1 : 0;
  s.eloRating = Math.round(s.eloRating + K * (S - E));
  s.gamesPlayed++;
  if (won) {
    s.wins++;
    s.streak++;
    s.maxStreak = Math.max(s.maxStreak, s.streak);
  } else {
    s.losses++;
    s.streak = 0;
  }
}

const providers = {};
const signers = {};
const amberMarkets = {};
const amberTokens = {};

const chains = [
  {
    id: 11155111,
    name: "Sepolia",
    rpc: process.env.SEPOLIA_RPC,
    contract: process.env.SEPOLIA_CONTRACT_ADDRESS,
    token: process.env.SEPOLIA_AMBER_TOKEN_ADDRESS
  },
  {
    id: 84532,
    name: "Base Sepolia",
    rpc: process.env.BASE_SEPOLIA_RPC,
    contract: process.env.BASE_SEPOLIA_CONTRACT_ADDRESS,
    token: process.env.BASE_SEPOLIA_AMBER_TOKEN_ADDRESS
  }
];

async function setupChain() {
  const isValidKey = /^(0x)?[0-9a-fA-F]{64}$/i.test(ORACLE_PRIVATE_KEY || "");

  if (!hasValidAmberMarketAbi || !hasValidAmberTokenAbi || !isValidKey) {
    console.warn("\n[!] Missing ABI or Private Key. On-chain disabled.");
    return;
  }

  for (const chain of chains) {
    if (!chain.rpc) {
      console.warn(`[!] Skipping ${chain.name}: missing RPC URL.`);
      continue;
    }

    try {
      const provider = new ethers.JsonRpcProvider(chain.rpc);
      const signer = new ethers.Wallet(ORACLE_PRIVATE_KEY, provider);
      providers[chain.id] = provider;
      signers[chain.id] = signer;

      const contractAddress =
        typeof chain.contract === "string" ? chain.contract.toLowerCase() : chain.contract;
      const tokenAddress =
        typeof chain.token === "string" ? chain.token.toLowerCase() : chain.token;

      let marketConnected = false;
      let tokenConnected = false;

      if (ethers.isAddress(contractAddress)) {
        try {
          const market = new ethers.Contract(contractAddress, amberMarketAbi, signer);
          await market.marketId();
          amberMarkets[chain.id] = market;
          marketConnected = true;
        } catch (marketErr) {
          console.error(`[!] Failed to connect ${chain.name} market:`, marketErr.message);
        }
      } else {
        console.warn(`[!] Skipping ${chain.name} market: invalid contract address.`);
      }

      if (ethers.isAddress(tokenAddress)) {
        try {
          const token = new ethers.Contract(tokenAddress, amberTokenAbi, signer);
          await token.symbol();
          amberTokens[chain.id] = token;
          tokenConnected = true;
        } catch (tokenErr) {
          console.error(`[!] Failed to connect ${chain.name} token:`, tokenErr.message);
        }
      } else {
        console.warn(`[!] Skipping ${chain.name} token: invalid token address.`);
      }

      if (marketConnected || tokenConnected) {
        console.log(`[✓] On-chain mode enabled for ${chain.name} (market=${marketConnected ? "on" : "off"}, token=${tokenConnected ? "on" : "off"})`);
      }
    } catch (err) {
      console.error(`[!] Failed to connect ${chain.name}:`, err.message);
    }
  }
}

function getMarketSnapshot() {
  return {
    junctionId: engine.activeJunctionId,
    engineState: engine.state,
    stateSinceMs: engine.stateSinceMs,
    countdown: engine.countdown,
    marketId: engine.marketId,
    lastSettlement: engine.lastSettlement,
    python: {
      currentCount: engine.python.lastCount,
      frames: engine.python.frames,
      running: Boolean(engine.python.proc),
    },
  };
}

function emitState() {
  io.emit("junction:state_change", getMarketSnapshot());
}

function getPrimaryChainInfo() {
  const connectedChainIds = [
    ...new Set([...Object.keys(amberTokens), ...Object.keys(amberMarkets)]),
  ].map(Number);
  const connectedChainId = Number(connectedChainIds[0] || 0);
  const connectedChain = chains.find((chain) => chain.id === connectedChainId);
  const fallbackChain = chains.find((chain) => chain.id === 84532) || chains[0] || {};
  const source = connectedChain || fallbackChain;

  return {
    rpc: source.rpc || BASE_SEPOLIA_RPC,
    contractAddress: source.contract || CONTRACT_ADDRESS || null,
    amberTokenAddress: source.token || AMBER_TOKEN_ADDRESS || null,
  };
}

async function updatePlayerStatsFromSettlement(settledMarketId) {
    if (Object.keys(amberMarkets).length === 0 || settledMarketId == null) return;

    for (const amberMarket of Object.values(amberMarkets)) {
      try {
          const bettors = await amberMarket.getBettors(settledMarketId);
          if (!Array.isArray(bettors) || bettors.length === 0) continue;

          const market = await amberMarket.getMarket(settledMarketId);
          const netPool = BigInt(market.netPool || 0n);
          const totalWeightedWinning = BigInt(market.totalWeightedWinning || 0n);   

          for (const bettorAddress of bettors) {
              try {
                  const bettor = normalizeAddress(bettorAddress);
                  if (!bettor) continue;

                  const stats = getOrCreateStats(bettor);
                  const weight = BigInt(await amberMarket.betWeights(settledMarketId, bettorAddress));
                  const bet = await amberMarket.getBet(settledMarketId, bettorAddress); 
                  const stakeAmount = BigInt(bet.stakeAmount || 0n);
                  const won = weight > 0n;

                  updateElo(bettor, won);

                  let payout = 0n;
                  if (won && totalWeightedWinning > 0n) {
                      payout = (weight * netPool) / totalWeightedWinning;
                  }
                  
                  stats.totalBets++;
                  stats.totalVolume += Number(ethers.formatUnits(stakeAmount, 18));
                  if (won) {
                      stats.totalWins++;
                      stats.totalEarnings += Number(ethers.formatUnits(payout, 18));
                  } else {
                      stats.totalLosses++;
                  }
              } catch (innerErr) {
                  console.error(`[stats] inner loop error on ${bettorAddress}:`, innerErr.message);
              }
          }
      } catch (err) {
          console.error("[stats] updatePlayerStatsFromSettlement failed for a chain:", err.message);
      }
    }
}

  // â”€â”€â”€ Oracle Functions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function oracleOpenMarket(junctionId) {
    if (Object.keys(amberMarkets).length === 0) return { mode: "simulated" };
    let mId = null;
    let res = null;
    for (const amberMarket of Object.values(amberMarkets)) {
      try {
        const currentId = await amberMarket.marketId();
        if (currentId > 0n) {
          const m = await amberMarket.markets(currentId);
          if (m.marketState === 0n) { // 0 = OPEN
            res = { mode: "onchain", marketId: Number(currentId) };
            mId = Number(currentId);
            continue;
          }
        }
        const tx = await amberMarket.openMarket(ethers.id(junctionId));
        const receipt = await tx.wait();
        mId = Number(await amberMarket.marketId());
        res = { mode: "onchain", txHash: receipt.hash, marketId: mId };
      } catch (err) {
        console.error("[oracle] openMarket failed for a chain:", err.message);
        res = { mode: "simulated", error: err.message };
      }
    }
    return res || { mode: "onchain", marketId: mId };
}
async function oracleLockMarket() {
    if (Object.keys(amberMarkets).length === 0) return { mode: "simulated" };
    let resMsg = null;
    for (const amberMarket of Object.values(amberMarkets)) {
      try {
        const currentId = await amberMarket.marketId();
        if (currentId > 0n) {
          const m = await amberMarket.markets(currentId);
          if (m.marketState === 1n) { // 1 = LOCKED
            resMsg = { mode: "onchain" };
            continue;
          }
        }
        const tx = await amberMarket.lockMarket();
        const receipt = await tx.wait();
        resMsg = { mode: "onchain", txHash: receipt.hash };
      } catch (err) {
        console.error("[oracle] lockMarket failed for a chain:", err.message);
        resMsg = { mode: "simulated", error: err.message };
      }
    }
    return resMsg || { mode: "onchain" };
}
async function oracleSubmitCount(count) {
    if (Object.keys(amberMarkets).length === 0) return { mode: "simulated" };
    let resMsg = null;
    for (const amberMarket of Object.values(amberMarkets)) {
      try {
        const tx = await amberMarket.submitCount(count);
        const receipt = await tx.wait();
        resMsg = { mode: "onchain", txHash: receipt.hash };
      } catch (err) {
        console.error("[oracle] submitCount failed for a chain:", err.message);
        resMsg = { mode: "simulated", error: err.message };
      }
    }
    return resMsg || { mode: "onchain" };
}

  // â”€â”€â”€ CV Pipeline â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function startPythonCounting(junctionId, streamUrl) {
  stopPythonCounting();
  const scriptPath = path.join(__dirname, "cv_oracle", "count_cars.py");
  if (!fs.existsSync(scriptPath)) {
    engine.python.proc = null;
    engine.python.lastCount = 0;
    engine.python.frames = 0;
    return;
  }
  const args = [scriptPath, "--junction_id", junctionId, "--stream_url", streamUrl];
  const proc = spawn("python", args, { stdio: ["ignore", "pipe", "pipe"] });
  engine.python.proc = proc;
  engine.python.lastCount = 0;
  engine.python.frames = 0;

  proc.stdout.on("data", (buf) => {
    const lines = buf.toString("utf8").split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        if (typeof msg.count === "number") engine.python.lastCount = msg.count;
        if (typeof msg.frames_processed === "number") engine.python.frames = msg.frames_processed;

        io.emit("oracle:counting", {
          junctionId,
          currentCount: engine.python.lastCount,
          frameNumber: engine.python.frames,
          detections: msg.detections || [],
          signalColor: msg.signal_color || "unknown",
        });

        if (msg.annotated_frame) {
          io.emit("oracle:annotated_frame", {
            junctionId,
            frame: msg.annotated_frame,
            count: engine.python.lastCount,
          });
        }
      } catch {
        // ignore non-json
      }
    }
  });

  proc.stderr.on("data", () => {});
  proc.on("exit", () => {
    engine.python.proc = null;
  });
}

function stopPythonCounting() {
  if (engine.python.proc) {
    try { engine.python.proc.kill("SIGTERM"); } catch { /* ignore */ }
    engine.python.proc = null;
  }
}

// ─── State Machine Transitions ───────────────────────
async function transition(next) {
  engine.state = next;
  engine.stateSinceMs = now();
  emitState();

  try {
    if (next === EngineState.PREDICTION_OPEN) {
      const openRes = await oracleOpenMarket(engine.activeJunctionId);
      engine.marketId = openRes.marketId ?? engine.marketId;
      io.emit("market:debug", { junctionId: engine.activeJunctionId, message: `PREDICTION_OPEN started` });
      // We now pause here indefinitely until /start-count is called
    }

    if (next === EngineState.PREDICTION_LOCKED) {
      await oracleLockMarket();
      io.emit("market:debug", { junctionId: engine.activeJunctionId, message: `PREDICTION_LOCKED — no more bets` });
      setTimeout(() => transition(EngineState.EVENT_RESOLUTION).catch(e => console.error("[engine]", e)), engine.countdown.predictionLockMs);
    }

    if (next === EngineState.EVENT_RESOLUTION) {
      const j = getJunctionById(engine.activeJunctionId);
      if (j?.stream_url) startPythonCounting(engine.activeJunctionId, j.stream_url);
      setTimeout(() => transition(EngineState.REWARD_DISTRIBUTION).catch(e => console.error("[engine]", e)), engine.countdown.resolutionMs);
    }

    if (next === EngineState.REWARD_DISTRIBUTION) {
      stopPythonCounting();
      const finalCount = engine.python.lastCount || Math.floor(10 + Math.random() * 25);
      await oracleSubmitCount(finalCount);

      if (engine.marketId != null) {
        await updatePlayerStatsFromSettlement(engine.marketId);
      }

      engine.lastSettlement = { finalCount, atMs: now() };
      io.emit("market:settled", { junctionId: engine.activeJunctionId, finalCount });

      setTimeout(() => transition(EngineState.PREDICTION_OPEN).catch(e => console.error("[engine]", e)), engine.countdown.rewardMs);
    }
  } catch (err) {
    console.error(`[engine] Error during ${next}:`, err.message);
    // Keep engine running — auto-recover
    if (next === EngineState.PREDICTION_OPEN) {
      // Stay open indefinitely if error occurs
    } else if (next === EngineState.PREDICTION_LOCKED) {
      setTimeout(() => transition(EngineState.EVENT_RESOLUTION).catch(e => console.error("[engine]", e)), engine.countdown.predictionLockMs);
    } else if (next === EngineState.EVENT_RESOLUTION) {
      setTimeout(() => transition(EngineState.REWARD_DISTRIBUTION).catch(e => console.error("[engine]", e)), engine.countdown.resolutionMs);
    } else if (next === EngineState.REWARD_DISTRIBUTION) {
      engine.lastSettlement = { finalCount: 0, atMs: now() };
      setTimeout(() => transition(EngineState.PREDICTION_OPEN).catch(e => console.error("[engine]", e)), engine.countdown.rewardMs);
    }
  }
}

// ─── API Routes ──────────────────────────────────────
app.get("/api/health", (req, res) => res.json({ ok: true }));

// ── ENS ──
app.get("/api/ens/check-availability", async (req, res) => {
  const label = normalizeEnsLabel(req.query.label || "");
  if (!label) return res.status(400).json({ error: "Missing label" });
  if (!isValidEnsLabel(label)) return res.json({ available: false, reason: "Invalid format" });
  if (!ensClient) return res.status(503).json({ error: "ENS not configured" });

  try {
    const fullName = `${label}.${ENS_PARENT_NAME}`;
    const { isAvailable } = await ensClient.isSubnameAvailable(fullName);
    res.json({ available: isAvailable, name: fullName });
  } catch (error) {
    console.error("[ENS] Availability check error:", error.message);
    res.status(500).json({ error: "Failed to check availability" });
  }
});

app.post("/api/ens/claim", async (req, res) => {
  const { label, address } = req.body;
  if (!label || !address) return res.status(400).json({ error: "Missing label or address" });
  if (!ensClient) return res.status(503).json({ error: "ENS API Key not configured on server" });

  const normalizedLabel = normalizeEnsLabel(label);
  if (!isValidEnsLabel(normalizedLabel)) {
    return res.status(400).json({ error: "Invalid label format. Use 3-63 lowercase letters, numbers, or hyphens." });
  }
  if (!isValidAddress(address)) {
    return res.status(400).json({ error: "Missing or invalid wallet address" });
  }

  // Rate limiting: 1 claim per address per cooldown window
  const addrKey = normalizeAddress(address);
  const lastClaim = ensClaimTimestamps.get(addrKey);
  if (lastClaim && (Date.now() - lastClaim) < ENS_CLAIM_COOLDOWN_MS) {
    const waitSec = Math.ceil((ENS_CLAIM_COOLDOWN_MS - (Date.now() - lastClaim)) / 1000);
    return res.status(429).json({ error: `Rate limited. Try again in ${waitSec} seconds.` });
  }

  try {
    const parentName = ENS_PARENT_NAME;
    const subname = `${normalizedLabel}.${parentName}`;

    // Check availability first
    const { isAvailable } = await ensClient.isSubnameAvailable(subname);
    if (!isAvailable) return res.status(409).json({ error: "Name is already taken" });

    const { ChainName } = require("@thenamespace/offchain-manager");
    await ensClient.createSubname({
      label: normalizedLabel,
      parentName,
      texts: [],
      addresses: [
        { chain: ChainName.Ethereum, value: address },
        { chain: ChainName.Base, value: address }
      ],
      owner: address,
      metadata: [{ key: 'sender', value: address }],
    });

    // Record successful claim timestamp
    ensClaimTimestamps.set(addrKey, Date.now());

    console.log(`✅ ENS Registered: ${subname} -> ${address}`);
    res.json({ success: true, name: subname });
  } catch (error) {
    // Clean log — avoid dumping entire Axios response
    const errMsg = error?.response?.data?.message || error.message;
    console.error("ENS Claim Error:", errMsg);
    
    // Axios HTTP errors from Namespace API
    if (error?.response?.status === 401 || error?.response?.status === 403) {
      return res.status(503).json({ error: "ENS API key is unauthorized. Regenerate with 'Domain based' scope at app.namespace.ninja." });
    }
    if (error?.response?.status === 409 || error.name === "SubnameAlreadyExistsError") {
      return res.status(409).json({ error: "This name is already registered" });
    }
    if (error?.response?.status === 429 || error.name === "RateLimitError") {
      return res.status(429).json({ error: "Too many requests. Please try again later." });
    }
    
    res.status(500).json({ error: errMsg || "Failed to create ENS subname" });
  }
});

app.post("/api/ens/verify", async (req, res) => {
  const { label, address } = req.body || {};
  if (!label || !address) {
    return res.status(400).json({ error: "Missing label or address" });
  }

  try {
    const verification = await verifySubnameOwnership(label, address);
    if (verification.error) {
      return res.status(400).json({ error: verification.error, verified: false });
    }
    res.json(verification);
  } catch (error) {
    console.error("ENS Verify Error:", error);
    res.status(500).json({ error: error.message || "Failed to verify ENS subname", verified: false });
  }
});

app.get("/api/ens/lookup/:address", async (req, res) => {
  const address = req.params.address;
  if (!address) return res.status(400).json({ error: "Missing address" });
  if (!ensClient) return res.json({ name: null });

  try {
    const page = await ensClient.getFilteredSubnames({
      parentName: ENS_PARENT_NAME,
      owner: address,
      page: 1,
      size: 1,
    });
    if (page && page.items && page.items.length > 0) {
      res.json({ name: page.items[0].fullName });
    } else {
      res.json({ name: null });
    }
  } catch (error) {
    console.error("ENS Lookup Error:", error);
    res.json({ name: null });
  }
});

// ── Leaderboard ──
app.get("/api/leaderboard", (req, res) => {
  const sorted = Object.entries(playerStats)
    .map(([address, stats]) => ({ address, ...stats }))
    .sort((a, b) => b.eloRating - a.eloRating)
    .slice(0, 50);
  res.json({ leaderboard: sorted });
});

app.get("/api/player/:address/stats", (req, res) => {
  const address = normalizeAddress(req.params.address);
  const stats = getOrCreateStats(address);
  res.json({ address, ...stats });
});

// ── $AMBER Faucet ──
app.post("/api/amber/faucet", async (req, res) => {
    const { address, chainId } = req.body;
    if (!address || !isValidAddress(address)) {
        return res.status(400).json({ error: "Missing or invalid address" });
    }

    let targetChainId = chainId ? Number(chainId) : 11155111;
    const aToken = amberTokens[targetChainId];

    if (!aToken) {
        return res.status(503).json({ error: "On-chain mode not available for this chain" });
    }

    try {
        const amount = ethers.parseUnits("1000", 18);
        let tx;
        let method = "mint";

        try {
            tx = await aToken.mint(address, amount);
        } catch (mintErr) {
            method = "transfer";
            tx = await aToken.transfer(address, amount);
        }

        const receipt = await tx.wait();
        const balance = await aToken.balanceOf(address);

        res.json({
            success: true,
            amount: "1000",
            method,
            txHash: receipt.hash,
            balance: ethers.formatUnits(balance, 18).toString()
        });
    } catch (err) {
        console.error("Faucet error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── CCTV ──
app.get("/api/cctv", (req, res) => {
  const list = getCctvCameras({ inServiceOnly: false, withStreamOnly: false, featuredFirst: true });
  res.json({ cameras: list });
});

app.get("/api/cctv/:slug", (req, res) => {
  const cam = getCctvBySlug(req.params.slug);
  if (!cam) return res.status(404).json({ error: "NOT_FOUND" });
  res.json(cam);
});

// ── Junctions ──
app.get("/api/junctions", (req, res) => {
  res.json({ junctions, activeJunctionId: engine.activeJunctionId });
});

app.post("/api/junctions/activate", (req, res) => {
  const { junctionId } = req.body || {};
  const j = getJunctionById(junctionId);
  if (!j) return res.status(404).json({ error: "NOT_FOUND" });
  engine.activeJunctionId = j.id;
  res.json({ ok: true, activeJunctionId: engine.activeJunctionId });
});

// ── Market ──
app.get("/api/market/_active", (req, res) => {
  return res.json(getMarketSnapshot());
});

app.get("/api/market/:junctionId", (req, res) => {
  if (req.params.junctionId !== engine.activeJunctionId) {
    return res.json({ ...getMarketSnapshot(), note: "Requested junction is not active." });
  }
  return res.json(getMarketSnapshot());
});

// ── Oracle manual endpoints ──
app.post("/api/oracle/open", async (req, res) => {
  const { junctionId } = req.body || {};
  try {
    const result = await oracleOpenMarket(junctionId || engine.activeJunctionId);
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || "UNKNOWN" });
  }
});

app.post("/api/oracle/lock", async (req, res) => {
  try {
    const result = await oracleLockMarket();
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || "UNKNOWN" });
  }
});

app.post("/api/market/start-count", async (req, res) => {
  if (engine.state !== EngineState.PREDICTION_OPEN) {
    return res.status(400).json({ error: "Market is not currently open for predictions." });
  }
  
  // Transition out of open immediately
  transition(EngineState.PREDICTION_LOCKED).catch(e => console.error("[engine]", e));
  res.json({ ok: true, message: "Countdown started" });
});

app.post("/api/oracle/submit", async (req, res) => {
  const { count } = req.body || {};
  try {
    const result = await oracleSubmitCount(Number(count));
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || "UNKNOWN" });
  }
});

// ─── Socket.IO ───────────────────────────────────────
io.on("connection", (socket) => {
  const primaryChain = getPrimaryChainInfo();

  socket.emit("server:hello", {
    ok: true,
    chain: {
      baseSepoliaRpc: primaryChain.rpc,
      contractAddress: isValidAddress(primaryChain.contractAddress) ? primaryChain.contractAddress : null,
      amberTokenAddress: isValidAddress(primaryChain.amberTokenAddress) ? primaryChain.amberTokenAddress : null,
      onchainEnabled: Object.keys(amberMarkets).length > 0 || Object.keys(amberTokens).length > 0,
    },
    market: getMarketSnapshot(),
  });
});

// ─── Start ───────────────────────────────────────────
server.listen(PORT, async () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  await setupChain();

  if (engine.state === EngineState.IDLE) {
    transition(EngineState.PREDICTION_OPEN).catch((e) => console.error("[engine] Initial transition error:", e));
  }
});
// Trigger nodemon restart 2