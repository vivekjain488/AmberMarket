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

const app = express();
app.use(express.json());
app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CLIENT_ORIGIN, credentials: true },
});

const amberMarketAbi = require("./abi/AmberMarket.abi.json");

function now() {
  return Date.now();
}

const EngineState = {
  IDLE: "IDLE",
  RED_OPEN: "RED_OPEN",
  GREEN_COUNTING: "GREEN_COUNTING",
  SETTLING: "SETTLING",
};

const engine = {
  activeJunctionId: junctions[0]?.id || "bkc-signal-1",
  state: EngineState.IDLE,
  stateSinceMs: now(),
  marketId: null,
  lastSettlement: null,
  countdown: { redMs: 30_000, greenMs: 20_000, settleMs: 3_000 },
  python: { proc: null, lastCount: 0, frames: 0 },
};

let provider = null;
let signer = null;
let amberMarket = null;

function emitState() {
  io.emit("junction:state_change", {
    junctionId: engine.activeJunctionId,
    state: engine.state === EngineState.RED_OPEN ? "RED" : engine.state === EngineState.GREEN_COUNTING ? "GREEN" : engine.state,
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

async function setupChain() {
  if (!CONTRACT_ADDRESS || !ORACLE_PRIVATE_KEY) return;
  provider = new ethers.JsonRpcProvider(BASE_SEPOLIA_RPC);
  signer = new ethers.Wallet(ORACLE_PRIVATE_KEY, provider);
  amberMarket = new ethers.Contract(CONTRACT_ADDRESS, amberMarketAbi, signer);

  amberMarket.on("BetPlaced", (mId, bettor, rangeMin, rangeMax, stakeAmount) => {
    io.emit("market:bet_placed", {
      junctionId: engine.activeJunctionId,
      marketId: Number(mId),
      bettor,
      rangeMin: Number(rangeMin),
      rangeMax: Number(rangeMax),
      stakeAmount: stakeAmount.toString(),
    });
  });

  amberMarket.on("MarketSettled", (mId, carCount, toleranceLow, toleranceHigh) => {
    io.emit("market:settled", {
      junctionId: engine.activeJunctionId,
      marketId: Number(mId),
      finalCount: Number(carCount),
      toleranceLow: Number(toleranceLow),
      toleranceHigh: Number(toleranceHigh),
    });
  });
}

async function oracleOpenMarket(junctionId) {
  if (!amberMarket) return { mode: "simulated" };
  const tx = await amberMarket.openMarket(ethers.id(junctionId));
  const receipt = await tx.wait();
  const mId = await amberMarket.marketId();
  return { mode: "onchain", txHash: receipt.hash, marketId: Number(mId) };
}

async function oracleLockMarket() {
  if (!amberMarket) return { mode: "simulated" };
  const tx = await amberMarket.lockMarket();
  const receipt = await tx.wait();
  return { mode: "onchain", txHash: receipt.hash };
}

async function oracleSubmitCount(count) {
  if (!amberMarket) return { mode: "simulated" };
  const tx = await amberMarket.submitCount(count);
  const receipt = await tx.wait();
  return { mode: "onchain", txHash: receipt.hash };
}

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
        io.emit("oracle:counting", { junctionId, currentCount: engine.python.lastCount, frameNumber: engine.python.frames });
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
    try {
      engine.python.proc.kill("SIGTERM");
    } catch {
      // ignore
    }
    engine.python.proc = null;
  }
}

async function transition(next) {
  engine.state = next;
  engine.stateSinceMs = now();
  emitState();

  if (next === EngineState.RED_OPEN) {
    const { stream_url } = getJunctionById(engine.activeJunctionId) || {};
    const openRes = await oracleOpenMarket(engine.activeJunctionId);
    engine.marketId = openRes.marketId ?? engine.marketId;

    io.emit("market:odds_update", { junctionId: engine.activeJunctionId, rangeBuckets: {}, impliedMultipliers: {} });
    setTimeout(() => transition(EngineState.GREEN_COUNTING), engine.countdown.redMs);

    io.emit("market:debug", { junctionId: engine.activeJunctionId, message: `RED_OPEN started (stream=${stream_url || "n/a"})` });
  }

  if (next === EngineState.GREEN_COUNTING) {
    await oracleLockMarket();
    const j = getJunctionById(engine.activeJunctionId);
    if (j?.stream_url) startPythonCounting(engine.activeJunctionId, j.stream_url);
    setTimeout(() => transition(EngineState.SETTLING), engine.countdown.greenMs);
  }

  if (next === EngineState.SETTLING) {
    stopPythonCounting();
    const finalCount = engine.python.lastCount || Math.floor(10 + Math.random() * 25);
    await oracleSubmitCount(finalCount);

    const toleranceLow = Math.floor((finalCount * 85) / 100);
    const toleranceHigh = Math.ceil((finalCount * 115) / 100);
    engine.lastSettlement = { finalCount, toleranceLow, toleranceHigh, atMs: now() };
    io.emit("market:settled", { junctionId: engine.activeJunctionId, finalCount, toleranceLow, toleranceHigh });

    setTimeout(() => transition(EngineState.RED_OPEN), engine.countdown.settleMs);
  }
}

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.get("/api/cctv", (req, res) => {
  const list = getCctvCameras({ inServiceOnly: false, withStreamOnly: false, featuredFirst: true });
  res.json({ cameras: list });
});

app.get("/api/cctv/:slug", (req, res) => {
  const cam = getCctvBySlug(req.params.slug);
  if (!cam) return res.status(404).json({ error: "NOT_FOUND" });
  res.json(cam);
});

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

app.get("/api/market/:junctionId", (req, res) => {
  if (req.params.junctionId !== engine.activeJunctionId) {
    return res.json({ ...getMarketSnapshot(), note: "Requested junction is not active; returning active junction state." });
  }
  return res.json(getMarketSnapshot());
});

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

io.on("connection", (socket) => {
  socket.emit("server:hello", {
    ok: true,
    chain: {
      baseSepoliaRpc: BASE_SEPOLIA_RPC,
      contractAddress: CONTRACT_ADDRESS || null,
      onchainEnabled: Boolean(CONTRACT_ADDRESS && ORACLE_PRIVATE_KEY),
    },
    market: getMarketSnapshot(),
  });
});

server.listen(PORT, async () => {
  await setupChain();
  console.log(`Server listening on http://localhost:${PORT}`);

  if (engine.state === EngineState.IDLE) {
    transition(EngineState.RED_OPEN).catch((e) => console.error("engine error", e));
  }
});