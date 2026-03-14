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

// ─── ENS Namespace Client ────────────────────────────
let ensClient = null;
if (NAMESPACE_API_KEY) {
  const { createOffchainClient } = require("@thenamespace/offchain-manager");
  ensClient = createOffchainClient({
    mode: "mainnet",
    timeout: 5000,
    defaultApiKey: NAMESPACE_API_KEY,
  });
  console.log("🟦 Namespace Offchain Client initialized.");
} else {
  console.warn("⚠️ NAMESPACE_API_KEY not found in .env. Real ENS claiming will be disabled.");
}

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
    predictionOpenMs: 60_000,  // 60s betting window
    predictionLockMs: 5_000,   // 5s locking countdown
    resolutionMs: 30_000,      // 30s car counting
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

let provider = null;
let signer = null;
let amberMarket = null;
let amberToken = null;

async function updatePlayerStatsFromSettlement(settledMarketId) {
  if (!amberMarket || settledMarketId == null) return;

  try {
    const bettors = await amberMarket.getBettors(settledMarketId);
    if (!Array.isArray(bettors) || bettors.length === 0) return;

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

        const profit = payout - stakeAmount;
        stats.totalProfit += Number(ethers.formatUnits(profit, 18));
      } catch (err) {
        console.warn("[stats] Failed to update bettor stats:", err.message);
      }
    }
  } catch (err) {
    console.warn("[stats] Failed to update settlement stats:", err.message);
  }
}

// ─── Socket helpers ──────────────────────────────────
function emitState() {
  io.emit("junction:state_change", {
    junctionId: engine.activeJunctionId,
    engineState: engine.state,
    stateSinceMs: engine.stateSinceMs,
    countdown: engine.countdown,
    marketId: engine.marketId,
    lastSettlement: engine.lastSettlement,
    timestamp: Math.floor(Date.now() / 1000),
  });
}

function getMarketSnapshot() {
  return {
    junctionId: engine.activeJunctionId,
    engineState: engine.state,
    stateSinceMs: engine.stateSinceMs,
    countdown: engine.countdown,
    marketId: engine.marketId,
    lastSettlement: engine.lastSettlement,
    python: { currentCount: engine.python.lastCount, frames: engine.python.frames, running: Boolean(engine.python.proc) },
  };
}

// ─── Chain Setup ─────────────────────────────────────
async function setupChain() {
  const isValidKey = /^(0x)?[0-9a-fA-F]{64}$/i.test(ORACLE_PRIVATE_KEY || "");

  if (!hasValidAmberMarketAbi || !hasValidAmberTokenAbi) {
    console.warn("\n[!] On-chain features disabled:");
    if (!hasValidAmberMarketAbi) {
      console.warn("    AmberMarket ABI is invalid or missing in server/abi/AmberMarket.abi.json.");
    }
    if (!hasValidAmberTokenAbi) {
      console.warn("    AmberToken ABI is invalid or missing in server/abi/AmberToken.abi.json.");
    }
    console.warn("[!] The server will run in simulation mode.\n");
    return;
  }

  if (!isValidAddress(CONTRACT_ADDRESS) || !isValidAddress(AMBER_TOKEN_ADDRESS) || !isValidKey) {
    console.warn("\n[!] On-chain features disabled:");
    if (!isValidAddress(CONTRACT_ADDRESS)) {
      console.warn("    CONTRACT_ADDRESS is missing or not a valid Ethereum address.");
    }
    if (!isValidAddress(AMBER_TOKEN_ADDRESS)) {
      console.warn("    AMBER_TOKEN_ADDRESS is missing or not a valid Ethereum address.");
    }
    if (!isValidKey) {
      console.warn("    ORACLE_PRIVATE_KEY is missing or invalid.");
    }
    console.warn("[!] The server will run in simulation mode.\n");
    return;
  }

  try {
    provider = new ethers.JsonRpcProvider(BASE_SEPOLIA_RPC);
    signer = new ethers.Wallet(ORACLE_PRIVATE_KEY, provider);
    amberMarket = new ethers.Contract(CONTRACT_ADDRESS, amberMarketAbi, signer);
    amberToken = new ethers.Contract(AMBER_TOKEN_ADDRESS, amberTokenAbi, signer);

    await amberMarket.marketId();
    await amberToken.symbol();
    console.log("[✓] On-chain mode enabled. Contract:", CONTRACT_ADDRESS);

    // Some public RPCs (like PublicNode) do not support eth_newFilter / eth_getFilterChanges.
    // Instead of using contract.on(), which crashes with "filter not found",
    // we'll rely on the server's own state machine to broadcast settlements to the UI,
    // and let the client fetch their own BetPlaced events via Viem if they want history.
    console.log("ℹ️ Contract event polling (eth_getFilterChanges) disabled for public RPC compatibility.");

  } catch (err) {
    console.warn("\n[!] Failed to connect to on-chain contract:", err.message);
    console.warn("[!] Falling back to simulation mode.\n");
    provider = null;
    signer = null;
    amberMarket = null;
    amberToken = null;
  }
}

// ─── Oracle Functions ────────────────────────────────
async function oracleOpenMarket(junctionId) {
  if (!amberMarket) return { mode: "simulated" };
  try {
    const tx = await amberMarket.openMarket(ethers.id(junctionId));
    const receipt = await tx.wait();
    const mId = await amberMarket.marketId();
    return { mode: "onchain", txHash: receipt.hash, marketId: Number(mId) };
  } catch (err) {
    console.error("[oracle] openMarket failed:", err.message);
    return { mode: "simulated", error: err.message };
  }
}

async function oracleLockMarket() {
  if (!amberMarket) return { mode: "simulated" };
  try {
    const tx = await amberMarket.lockMarket();
    const receipt = await tx.wait();
    return { mode: "onchain", txHash: receipt.hash };
  } catch (err) {
    console.error("[oracle] lockMarket failed:", err.message);
    return { mode: "simulated", error: err.message };
  }
}

async function oracleSubmitCount(count) {
  if (!amberMarket) return { mode: "simulated" };
  try {
    const tx = await amberMarket.submitCount(count);
    const receipt = await tx.wait();
    return { mode: "onchain", txHash: receipt.hash };
  } catch (err) {
    console.error("[oracle] submitCount failed:", err.message);
    return { mode: "simulated", error: err.message };
  }
}

// ─── CV Pipeline ─────────────────────────────────────
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
      setTimeout(() => transition(EngineState.PREDICTION_LOCKED).catch(e => console.error("[engine]", e)), engine.countdown.predictionOpenMs);
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
      setTimeout(() => transition(EngineState.PREDICTION_LOCKED).catch(e => console.error("[engine]", e)), engine.countdown.predictionOpenMs);
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
app.post("/api/ens/claim", async (req, res) => {
  const { label, address } = req.body;
  if (!label || !address) return res.status(400).json({ error: "Missing label or address" });
  if (!ensClient) return res.status(503).json({ error: "ENS API Key not configured on server" });

  try {
    const parentName = "ambermarket.eth";
    const subname = `${label}.${parentName}`;
    const { isAvailable } = await ensClient.isSubnameAvailable(subname);
    if (!isAvailable) return res.status(409).json({ error: "Name is already taken" });

    const { ChainName } = require("@thenamespace/offchain-manager");
    await ensClient.createSubname({
      label,
      parentName,
      texts: [],
      addresses: [
        { chain: ChainName.Ethereum, value: address },
        { chain: ChainName.Base, value: address }
      ],
      owner: address,
      metadata: [{ key: 'sender', value: address }],
    });

    console.log(`✅ ENS Registered: ${subname} -> ${address}`);
    res.json({ success: true, name: subname });
  } catch (error) {
    console.error("ENS Claim Error:", error);
    res.status(500).json({ error: error.message || "Failed to create ENS subname" });
  }
});

app.get("/api/ens/lookup/:address", async (req, res) => {
  const address = req.params.address;
  if (!address) return res.status(400).json({ error: "Missing address" });
  if (!ensClient) return res.json({ name: null });

  try {
    const page = await ensClient.getFilteredSubnames({
      parentName: "ambermarket.eth",
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
  const { address } = req.body;
  if (!address || !isValidAddress(address)) {
    return res.status(400).json({ error: "Missing or invalid address" });
  }

  if (!provider || !signer || !amberToken) {
    return res.status(503).json({ error: "On-chain mode not available" });
  }

  try {
    const amount = ethers.parseUnits("1000", 18);
    let tx;
    let method = "mint";

    try {
      tx = await amberToken.mint(address, amount);
    } catch (mintErr) {
      method = "transfer";
      tx = await amberToken.transfer(address, amount);
      console.warn("[faucet] mint failed, fallback to transfer:", mintErr.message);
    }

    const receipt = await tx.wait();
    const balance = await amberToken.balanceOf(address);

    console.log(`🪙 Faucet: sent 1000 $AMBER to ${address} via ${method}`);
    res.json({
      success: true,
      amount: "1000",
      method,
      txHash: receipt.hash,
      balance: ethers.formatUnits(balance, 18),
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
  socket.emit("server:hello", {
    ok: true,
    chain: {
      baseSepoliaRpc: BASE_SEPOLIA_RPC,
      contractAddress: isValidAddress(CONTRACT_ADDRESS) ? CONTRACT_ADDRESS : null,
      amberTokenAddress: isValidAddress(AMBER_TOKEN_ADDRESS) ? AMBER_TOKEN_ADDRESS : null,
      onchainEnabled: Boolean(amberMarket),
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