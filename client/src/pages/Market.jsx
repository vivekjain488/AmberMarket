import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import Hls from "hls.js";
import {
  ArrowLeft, Camera, Car, Clock, DollarSign, Eye,
  Landmark, Signal, TrendingUp, Zap, Hash,
  AlertCircle, CheckCircle2, Loader2, ExternalLink,
  Minus, Plus, Coins, Scale, BarChart3, History
} from "lucide-react";

import { TerminalShell } from "@/components/TerminalShell";
import { StatusBadge } from "@/components/StatusBadge";
import { CountdownRing } from "@/components/CountdownRing";
import { PhaseIndicator } from "@/components/PhaseIndicator";
import { SettlementModal } from "@/components/SettlementModal";
import { useSocket } from "@/hooks/useSocket";
import { config } from "@/lib/config";
import { amberMarketAbi } from "@/lib/amberMarketAbi";

import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { parseUnits, formatUnits } from "viem";

/* ═══════════════════════════════════════════════
   H E L P E R S
   ═══════════════════════════════════════════════ */

function msLeft(stateSinceMs, durationMs) {
  const elapsed = Date.now() - stateSinceMs;
  return Math.max(0, durationMs - elapsed);
}

function toYouTubeEmbedUrl(url) {
  try {
    const u = new URL(url);
    const v = u.searchParams.get("v");
    if (!v) return null;
    return `https://www.youtube.com/embed/${v}?autoplay=1&mute=1`;
  } catch {
    return null;
  }
}

function isHlsUrl(url) {
  return typeof url === "string" && (url.includes(".m3u8") || url.includes("playlist.m3u8"));
}

/** Auto‑tolerance: the server uses ±15 %, so we mirror that for the UI preview. */
function computeRange(prediction) {
  const p = Math.max(0, Math.floor(Number(prediction) || 0));
  if (p === 0) return { min: 0, max: 0 };
  const low = Math.floor(p * 0.85);
  const high = Math.ceil(p * 1.15);
  return { min: low, max: high };
}

/** Format large numbers: 1000 -> 1,000 */
function fmt(n) {
  if (n == null || n === "—") return "—";
  return Number(n).toLocaleString();
}

/* ═══════════════════════════════════════════════
   H L S   V I D E O   P L A Y E R
   ═══════════════════════════════════════════════ */

function HlsVideoPlayer({ src, className }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!src || !videoRef.current) return;
    setError(null);
    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true });
      hlsRef.current = hls;
      hls.loadSource(src);
      hls.attachMedia(videoRef.current);
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) setError(data.type + ": " + (data.details || ""));
      });
      return () => {
        hls.destroy();
        hlsRef.current = null;
      };
    }
    if (videoRef.current.canPlayType("application/vnd.apple.mpegurl")) {
      videoRef.current.src = src;
      return () => { videoRef.current.src = ""; };
    }
    setError("HLS not supported");
  }, [src]);

  if (error) {
    return (
      <div className={className + " flex items-center justify-center gap-2 p-6 text-sm text-amber-400"}>
        <AlertCircle className="h-4 w-4" />
        {error}
      </div>
    );
  }
  return <video ref={videoRef} className={className} muted autoPlay playsInline controls />;
}

/* ═══════════════════════════════════════════════
   D A T A   T I L E
   ═══════════════════════════════════════════════ */

function DataTile({ icon: Icon, label, value, sub, accent = false, className = "" }) {
  return (
    <div className={`glass rounded-xl p-4 ${className}`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`h-3.5 w-3.5 ${accent ? 'text-primary' : 'text-muted-foreground'}`} />
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <div className={`text-xl font-bold font-mono ${accent ? 'text-primary' : 'text-foreground'}`}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-muted-foreground mt-1 font-mono">{sub}</div>}
    </div>
  );
}

/* ═══════════════════════════════════════════════
   R O U N D   H I S T O R Y   R O W
   ═══════════════════════════════════════════════ */

function RoundHistoryRow({ round }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-border/30 last:border-0">
      <div className="flex items-center gap-2">
        <div className="h-6 w-6 rounded-md bg-primary/10 flex items-center justify-center">
          <Car className="h-3 w-3 text-primary" />
        </div>
        <span className="font-mono text-sm font-medium">{round.finalCount} cars</span>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
        <span>[{round.toleranceLow}–{round.toleranceHigh}]</span>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   M A R K E T   P A G E
   ═══════════════════════════════════════════════ */

export function Market() {
  const { junctionId } = useParams();
  const {
    connected, hello,
    marketState: socketMarket,
    counting, settled,
    newSettlement, dismissSettlement,
    lastBet,
    annotatedFrame,
  } = useSocket();

  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  /* ── Local state ── */
  const [junction, setJunction] = useState(null);
  const [restMarket, setRestMarket] = useState(null);  // initial REST fetch
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Prediction = single number
  const [prediction, setPrediction] = useState(15);
  const [stake, setStake] = useState("1");
  const [txStatus, setTxStatus] = useState(null);
  const [txLoading, setTxLoading] = useState(false);

  // On-chain pool data
  const [poolData, setPoolData] = useState(null);

  // Round history (kept locally from settlement events)
  const [roundHistory, setRoundHistory] = useState([]);

  /* ── Fetch junction info ── */
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${config.serverUrl}/api/junctions`);
        const data = await res.json();
        const j = (data.junctions || []).find((x) => x.id === junctionId);
        setJunction(j || null);
      } catch (err) {
        console.error("Failed to fetch junctions:", err);
      }
    })();
  }, [junctionId]);

  /* ── Fetch initial market state via REST ── */
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${config.serverUrl}/api/market/${junctionId}`);
        const data = await res.json();
        setRestMarket(data);
        // Pre-populate history from server
        if (data?.lastSettlement?.finalCount != null) {
          setRoundHistory((prev) => {
            if (prev.some(r => r.atMs === data.lastSettlement.atMs)) return prev;
            return [data.lastSettlement, ...prev].slice(0, 10);
          });
        }
      } catch (err) {
        console.error("Failed to fetch market:", err);
      }
    })();
  }, [junctionId]);

  /* ── Re-fetch market state every time phase transitions (to stay in sync) ── */
  const phase = socketMarket?.engineState || restMarket?.engineState || "UNKNOWN";
  useEffect(() => {
    // When socket gives us a new phase, also re-fetch REST to get python counts etc.
    if (!socketMarket?.engineState) return;
    (async () => {
      try {
        const res = await fetch(`${config.serverUrl}/api/market/${junctionId}`);
        const data = await res.json();
        setRestMarket(data);
      } catch { /* ignore */ }
    })();
  }, [socketMarket?.engineState, junctionId]);

  /* ── Polling fallback: if socket is disconnected, poll REST every 5s ── */
  useEffect(() => {
    if (connected) return; // socket is live, no need to poll
    const poll = setInterval(async () => {
      try {
        const res = await fetch(`${config.serverUrl}/api/market/${junctionId}`);
        const data = await res.json();
        setRestMarket(data);
      } catch { /* server offline */ }
    }, 5000);
    return () => clearInterval(poll);
  }, [connected, junctionId]);

  /* ── Track settlement events in round history ── */
  useEffect(() => {
    if (settled?.finalCount != null) {
      setRoundHistory((prev) => {
        const entry = { ...settled, atMs: Date.now() };
        return [entry, ...prev].slice(0, 10);
      });
    }
  }, [settled]);

  /* ── On-chain pool data reader ── */
  useEffect(() => {
    if (!publicClient || !config.contractAddress) return;
    let cancelled = false;

    async function fetchPool() {
      try {
        const data = await publicClient.readContract({
          address: config.contractAddress,
          abi: amberMarketAbi,
          functionName: "getCurrentMarket",
        });
        if (!cancelled) {
          setPoolData({
            totalStaked: data.totalStaked,
            totalWinningStaked: data.totalWinningStaked,
            netPool: data.netPool,
            toleranceLow: Number(data.toleranceLow),
            toleranceHigh: Number(data.toleranceHigh),
            settlementCount: Number(data.settlementCount),
          });
        }
      } catch {
        // Contract not deployed or no provider — run in demo mode
      }
    }

    fetchPool();
    const t = setInterval(fetchPool, 10000); // poll every 10s
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [publicClient, config.contractAddress, phase]);

  /* ── Real-time tick ── */
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 200);
    return () => clearInterval(t);
  }, []);

  /* ── Merge socket + REST market state: socket takes priority ── */
  const mergedMarket = useMemo(() => {
    return {
      ...(restMarket || {}),
      ...(socketMarket || {}),
    };
  }, [restMarket, socketMarket]);

  const stateSinceMs = mergedMarket?.stateSinceMs || nowMs;
  const countdown = mergedMarket?.countdown || { redMs: 30000, greenMs: 20000, settleMs: 3000 };

  /* ── Time left (recomputed every tick) ── */
  const timeLeftMs = useMemo(() => {
    if (phase === "RED_OPEN") return msLeft(stateSinceMs, countdown.redMs);
    if (phase === "GREEN_COUNTING") return msLeft(stateSinceMs, countdown.greenMs);
    if (phase === "SETTLING") return msLeft(stateSinceMs, countdown.settleMs || 3000);
    return 0;
  }, [phase, stateSinceMs, countdown, nowMs]);

  const totalMs = useMemo(() => {
    if (phase === "RED_OPEN") return countdown.redMs;
    if (phase === "GREEN_COUNTING") return countdown.greenMs;
    if (phase === "SETTLING") return countdown.settleMs || 3000;
    return 1;
  }, [phase, countdown]);

  const phaseLabel = useMemo(() => {
    switch (phase) {
      case "RED_OPEN": return "Betting Open";
      case "GREEN_COUNTING": return "Counting Cars";
      case "SETTLING": return "Settling";
      case "IDLE": return "Starting…";
      default: return "Connecting…";
    }
  }, [phase]);

  /* ── Prediction to range conversion ── */
  const predRange = useMemo(() => computeRange(prediction), [prediction]);

  /* ── Pool math in USDC ── */
  const poolTotal = poolData?.totalStaked ? Number(formatUnits(poolData.totalStaked, 6)) : null;
  const poolNet = poolData?.netPool ? Number(formatUnits(poolData.netPool, 6)) : null;
  const poolWinning = poolData?.totalWinningStaked ? Number(formatUnits(poolData.totalWinningStaked, 6)) : null;

  // Leverage = pool / your stake (how many x your money is worth if you win)
  const stakeNum = Number(stake) || 0;
  const leverage = poolTotal && stakeNum > 0 && poolWinning && poolWinning > 0
    ? ((poolTotal / poolWinning) * 1).toFixed(2)
    : null;

  // Potential payout = (your_stake / total_winning_staked) * total_pool
  const potentialPayout = poolTotal && poolWinning && poolWinning > 0 && stakeNum > 0
    ? ((stakeNum / poolWinning) * poolTotal).toFixed(2)
    : null;

  /* ── Live data ── */
  const currentCount = counting?.currentCount ?? restMarket?.python?.currentCount ?? 0;
  const frameCount = counting?.frameNumber ?? restMarket?.python?.frames ?? 0;
  const lastFinalCount = settled?.finalCount ?? mergedMarket?.lastSettlement?.finalCount;
  const lastLow = settled?.toleranceLow ?? mergedMarket?.lastSettlement?.toleranceLow;
  const lastHigh = settled?.toleranceHigh ?? mergedMarket?.lastSettlement?.toleranceHigh;

  /* ═══════════════════════════════════════════════
     A C T I O N S
     ═══════════════════════════════════════════════ */

  async function placeBet() {
    setTxStatus(null);
    if (!walletClient || !address) return setTxStatus("Connect wallet first.");
    if (!config.contractAddress) return setTxStatus("Missing contract address.");
    if (Number(prediction) <= 0) return setTxStatus("Enter a valid prediction.");

    setTxLoading(true);
    try {
      const { min, max } = computeRange(prediction);
      const stakeAmount = parseUnits(stake || "0", 6);
      const hash = await walletClient.writeContract({
        address: config.contractAddress,
        abi: amberMarketAbi,
        functionName: "placeBet",
        args: [min, max, stakeAmount],
      });
      setTxStatus(`Bet submitted! Tx: ${hash.slice(0, 10)}…`);
      await publicClient.waitForTransactionReceipt({ hash });
      setTxStatus("✓ Bet confirmed on-chain!");
    } catch (e) {
      setTxStatus(e?.shortMessage || e?.message || "Bet failed");
    } finally {
      setTxLoading(false);
    }
  }

  async function claim() {
    setTxStatus(null);
    if (!walletClient || !address) return setTxStatus("Connect wallet first.");
    if (!config.contractAddress) return setTxStatus("Missing contract address.");

    setTxLoading(true);
    try {
      const hash = await walletClient.writeContract({
        address: config.contractAddress,
        abi: amberMarketAbi,
        functionName: "claimWinnings",
        args: [],
      });
      setTxStatus(`Claim submitted! Tx: ${hash.slice(0, 10)}…`);
      await publicClient.waitForTransactionReceipt({ hash });
      setTxStatus("✓ Claim confirmed!");
    } catch (e) {
      setTxStatus(e?.shortMessage || e?.message || "Claim failed");
    } finally {
      setTxLoading(false);
    }
  }

  /* ═══════════════════════════════════════════════
     R E N D E R
     ═══════════════════════════════════════════════ */

  return (
    <TerminalShell
      title={junction?.name || junctionId}
      right={
        <StatusBadge
          connected={connected}
          label={hello?.chain?.onchainEnabled ? "On-chain" : connected ? "Simulated" : "Offline"}
        />
      }
    >
      {/* ── Settlement Popup ── */}
      <SettlementModal
        settlement={newSettlement}
        userPrediction={prediction}
        onDismiss={dismissSettlement}
      />

      {/* ── Back nav + Market header ── */}
      <div className="mb-6 animate-fade-in">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          All Markets
        </Link>

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {junction?.name || "Loading…"}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">{junction?.description}</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20 text-primary text-sm font-bold font-mono">
              {junction?.multiplier_tier || 1}x Multiplier
            </div>
            <div className="px-3 py-1.5 rounded-lg bg-secondary text-muted-foreground text-sm font-mono">
              {junction?.road_count || "—"} Roads
            </div>
          </div>
        </div>
      </div>

      {/* ── Phase Indicator ── */}
      <div className="mb-6 animate-fade-in-up">
        <PhaseIndicator currentPhase={phase} />
      </div>

      {/* ── Main Grid ── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[420px_1fr] animate-fade-in-up">
        {/* ═══ LEFT COLUMN: Trading Panel ═══ */}
        <div className="space-y-4">
          {/* ── Phase + Countdown ── */}
          <div className="glass rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                  Current Phase
                </div>
                <div className={`text-lg font-bold ${
                  phase === "RED_OPEN" ? "text-red-400" :
                  phase === "GREEN_COUNTING" ? "text-emerald-400" :
                  phase === "SETTLING" ? "text-amber-400" :
                  "text-muted-foreground"
                }`}>
                  {phaseLabel}
                </div>
              </div>
              <CountdownRing
                timeLeftMs={timeLeftMs}
                totalMs={totalMs}
                size={80}
                strokeWidth={4}
              />
            </div>

            {phase === "RED_OPEN" && (
              <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
                <Zap className="h-3.5 w-3.5" />
                Betting is open! Predict the number of cars now.
              </div>
            )}
            {phase === "GREEN_COUNTING" && (
              <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                <Eye className="h-3.5 w-3.5" />
                Light is green — counting cars from CCTV.
              </div>
            )}
            {phase === "SETTLING" && (
              <div className="flex items-center gap-2 text-xs text-primary bg-primary/10 border border-primary/20 rounded-lg px-3 py-2">
                <Landmark className="h-3.5 w-3.5" />
                Market settling — results momentarily.
              </div>
            )}
          </div>

          {/* ── Prediction Form ── */}
          <div className="glass rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">Your Prediction</span>
            </div>

            <div className="space-y-4">
              {/* === Single prediction number input === */}
              <div>
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-2">
                  How many cars will cross?
                </label>
                <div className="flex items-center gap-2">
                  <button
                    className="h-10 w-10 rounded-lg bg-secondary border border-border flex items-center justify-center hover:bg-secondary/80 hover:border-primary/30 transition-colors text-foreground disabled:opacity-30"
                    onClick={() => setPrediction(Math.max(0, Number(prediction) - 1))}
                    disabled={Number(prediction) <= 0}
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <div className="flex-1 relative">
                    <Hash className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <input
                      className="w-full rounded-lg bg-secondary/80 border border-border pl-9 pr-3 py-2.5 font-mono text-lg font-bold text-center text-foreground outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 transition-colors"
                      type="number"
                      value={prediction}
                      onChange={(e) => setPrediction(Math.max(0, Math.min(150, Number(e.target.value) || 0)))}
                      min={0}
                      max={150}
                    />
                  </div>
                  <button
                    className="h-10 w-10 rounded-lg bg-secondary border border-border flex items-center justify-center hover:bg-secondary/80 hover:border-primary/30 transition-colors text-foreground disabled:opacity-30"
                    onClick={() => setPrediction(Math.min(150, Number(prediction) + 1))}
                    disabled={Number(prediction) >= 150}
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Tolerance preview bar */}
              <div>
                <div className="flex items-center justify-between text-[10px] text-muted-foreground font-mono mb-1">
                  <span>Winning range if count = {prediction}</span>
                  <span className="text-primary">[{predRange.min}–{predRange.max}]</span>
                </div>
                <div className="relative h-2 rounded-full bg-secondary overflow-hidden">
                  <div
                    className="absolute h-full rounded-full bg-gradient-to-r from-emerald-500/50 via-primary to-emerald-500/50 transition-all duration-300"
                    style={{
                      left: `${(predRange.min / 150) * 100}%`,
                      width: `${((predRange.max - predRange.min) / 150) * 100}%`,
                    }}
                  />
                  {/* Your prediction marker */}
                  <div
                    className="absolute h-3.5 w-1 bg-primary rounded-full -top-[3px] transition-all duration-300 shadow-sm shadow-amber-500/40"
                    style={{ left: `${(Number(prediction) / 150) * 100}%` }}
                  />
                </div>
                <div className="flex justify-between text-[9px] text-muted-foreground/50 font-mono mt-0.5">
                  <span>0</span>
                  <span>75</span>
                  <span>150</span>
                </div>
              </div>

              {/* Quick picks */}
              <div className="flex gap-2">
                {[5, 10, 15, 20, 30, 50].map((n) => (
                  <button
                    key={n}
                    className={`flex-1 py-1.5 rounded-md text-xs font-mono font-medium transition-all ${
                      Number(prediction) === n
                        ? 'bg-primary/20 text-primary border border-primary/30'
                        : 'bg-secondary/60 text-muted-foreground border border-transparent hover:border-border hover:text-foreground'
                    }`}
                    onClick={() => setPrediction(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>

              {/* Stake input */}
              <div>
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">
                  Stake (USDC)
                </label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    className="w-full rounded-lg bg-secondary/80 border border-border pl-9 pr-3 py-2.5 font-mono text-sm text-foreground outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 transition-colors"
                    type="number"
                    step="0.1"
                    min="0"
                    value={stake}
                    onChange={(e) => setStake(e.target.value)}
                    placeholder="1.00"
                  />
                </div>
                {/* Quick stake buttons */}
                <div className="flex gap-2 mt-2">
                  {["1", "5", "10", "25", "50"].map((s) => (
                    <button
                      key={s}
                      className={`flex-1 py-1 rounded-md text-xs font-mono font-medium transition-all ${
                        stake === s
                          ? 'bg-primary/20 text-primary border border-primary/30'
                          : 'bg-secondary/60 text-muted-foreground border border-transparent hover:border-border'
                      }`}
                      onClick={() => setStake(s)}
                    >
                      ${s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Pool stats */}
              {(poolTotal != null || stakeNum > 0) && (
                <div className="glass rounded-lg p-3 space-y-2">
                  <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Pool & Leverage
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total Pool</span>
                      <span className="font-mono text-foreground">{poolTotal != null ? `$${poolTotal.toFixed(2)}` : '—'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Your Stake</span>
                      <span className="font-mono text-primary">${stakeNum.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Leverage</span>
                      <span className="font-mono text-emerald-400">{leverage ? `${leverage}x` : '—'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Max Payout</span>
                      <span className="font-mono text-emerald-400">{potentialPayout ? `$${potentialPayout}` : '—'}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Place Bet Button */}
              <button
                className="w-full py-3 rounded-xl font-semibold text-sm transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed bg-gradient-to-r from-primary to-amber-500 text-primary-foreground hover:shadow-lg hover:shadow-amber-500/20 hover:scale-[1.01] active:scale-[0.99]"
                onClick={placeBet}
                disabled={phase !== "RED_OPEN" || txLoading || Number(prediction) <= 0 || stakeNum <= 0}
              >
                {txLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Confirming…
                  </span>
                ) : phase !== "RED_OPEN" ? (
                  "Betting Closed"
                ) : (
                  <>Predict {prediction} cars — ${stake} USDC</>
                )}
              </button>

              {/* Claim Button */}
              <button
                className="w-full py-2.5 rounded-xl font-medium text-sm transition-all duration-200 border border-border bg-secondary/40 text-foreground hover:bg-secondary/60 hover:border-primary/30 disabled:opacity-30 disabled:cursor-not-allowed"
                onClick={claim}
                disabled={(phase !== "SETTLING" && phase !== "RED_OPEN") || txLoading}
              >
                <span className="flex items-center justify-center gap-2">
                  <Coins className="h-4 w-4" />
                  Claim Winnings
                </span>
              </button>

              {/* Tx Status */}
              {txStatus && (
                <div className={`flex items-start gap-2 text-xs rounded-lg px-3 py-2.5 ${
                  txStatus.includes("✓")
                    ? 'text-emerald-400 bg-emerald-500/10 border border-emerald-500/20'
                    : txStatus.includes("Tx:")
                      ? 'text-amber-400 bg-amber-500/10 border border-amber-500/20'
                      : 'text-red-400 bg-red-500/10 border border-red-500/20'
                }`}>
                  {txStatus.includes("✓")
                    ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    : <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  }
                  <span className="break-all">{txStatus}</span>
                </div>
              )}
            </div>
          </div>

          {/* ── Live Data ── */}
          <div className="grid grid-cols-2 gap-3">
            <DataTile icon={Car} label="Live Count" value={currentCount} accent sub={phase === "GREEN_COUNTING" ? "counting…" : ""} />
            <DataTile icon={Eye} label="Frames" value={frameCount} sub="processed" />
          </div>

          {/* ── Last Settlement ── */}
          <div className="glass rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <Landmark className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">Last Settlement</span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Low</div>
                <div className="font-mono font-bold text-muted-foreground">{lastLow ?? "—"}</div>
              </div>
              <div className="text-center">
                <div className="text-[10px] text-primary uppercase tracking-wider mb-1">Count</div>
                <div className="font-mono font-bold text-2xl text-primary">{lastFinalCount ?? "—"}</div>
              </div>
              <div className="text-center">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">High</div>
                <div className="font-mono font-bold text-muted-foreground">{lastHigh ?? "—"}</div>
              </div>
            </div>
            {lastFinalCount != null && lastLow != null && lastHigh != null && (
              <div className="mt-3 relative h-1.5 rounded-full bg-secondary overflow-hidden">
                <div
                  className="absolute h-full rounded-full bg-gradient-to-r from-emerald-500/60 via-primary to-emerald-500/60"
                  style={{
                    left: `${(lastLow / Math.max(lastHigh * 1.5, 50)) * 100}%`,
                    width: `${((lastHigh - lastLow) / Math.max(lastHigh * 1.5, 50)) * 100}%`,
                  }}
                />
                <div
                  className="absolute h-3 w-0.5 bg-primary rounded-full -top-[3px]"
                  style={{ left: `${(lastFinalCount / Math.max(lastHigh * 1.5, 50)) * 100}%` }}
                />
              </div>
            )}
          </div>

          {/* ── Round History ── */}
          {roundHistory.length > 0 && (
            <div className="glass rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <History className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold">Round History</span>
                <span className="ml-auto text-[10px] text-muted-foreground font-mono">{roundHistory.length} rounds</span>
              </div>
              <div className="space-y-0">
                {roundHistory.map((r, i) => (
                  <RoundHistoryRow key={`${r.finalCount}-${r.atMs || i}`} round={r} />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ═══ RIGHT COLUMN: CCTV Feed ═══ */}
        <div className="space-y-4">
          {/* Video Feed */}
          <div className="glass rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border/40 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Camera className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold">CCTV Feed</span>
                {phase === "GREEN_COUNTING" && (
                  <div className="flex items-center gap-1 ml-2 px-2 py-0.5 bg-red-500/15 border border-red-500/25 rounded-full">
                    <div className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                    <span className="text-[10px] text-red-400 font-semibold uppercase">Recording</span>
                  </div>
                )}
              </div>
              {junction?.vmPageUrl && (
                <a
                  href={junction.vmPageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-primary hover:text-amber-300 transition-colors"
                >
                  Source <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>

            <div className="relative bg-black/60 overflow-hidden">
              {annotatedFrame ? (
                <div className="relative h-[50vh] lg:h-[55vh] w-full bg-black flex items-center justify-center">
                  <img
                    src={`data:image/jpeg;base64,${annotatedFrame.frame}`}
                    alt="CV Annotated Frame"
                    className="max-h-full max-w-full object-contain"
                  />
                  <div className="absolute top-3 left-3 px-2 py-1 rounded bg-black/60 border border-emerald-500/30 text-emerald-400 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 backdrop-blur-sm">
                    <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Live CV Tracking
                  </div>
                </div>
              ) : junction?.stream_url && toYouTubeEmbedUrl(junction.stream_url) ? (
                <iframe
                  title="cctv"
                  className="h-[50vh] lg:h-[55vh] w-full"
                  src={toYouTubeEmbedUrl(junction.stream_url)}
                  allow="autoplay; encrypted-media"
                />
              ) : junction?.stream_url && isHlsUrl(junction.stream_url) ? (
                <HlsVideoPlayer
                  src={junction.stream_url}
                  className="h-[50vh] lg:h-[55vh] w-full object-contain bg-black"
                />
              ) : junction?.stream_url ? (
                <div className="h-[30vh] flex items-center justify-center p-6">
                  <div className="text-center">
                    <Camera className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">Unsupported stream format</p>
                    {junction.vmPageUrl && (
                      <a href={junction.vmPageUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline mt-2 inline-block">
                        View on Caltrans VM →
                      </a>
                    )}
                  </div>
                </div>
              ) : (
                <div className="h-[30vh] flex items-center justify-center p-6">
                  <div className="text-center">
                    <Camera className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">No stream configured</p>
                  </div>
                </div>
              )}

              {/* Live count overlay */}
              {phase === "GREEN_COUNTING" && !annotatedFrame && (
                <div className="absolute top-4 right-4 glass rounded-xl px-4 py-3 flex items-center gap-3">
                  <Car className="h-5 w-5 text-primary" />
                  <div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Count</div>
                    <div className="font-mono text-xl font-bold text-primary">{currentCount}</div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Footage / Snapshots ── */}
          {(junction?.currentImageURL || (junction?.referenceImageUrls?.length > 0)) && (
            <div className="glass rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Eye className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold">Footage Snapshots</span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                {junction.currentImageURL && (
                  <div className="relative rounded-lg overflow-hidden border border-primary/20 group">
                    <img
                      src={junction.currentImageURL + "?t=" + Math.floor(Date.now() / 15000)}
                      alt="Current"
                      className="w-full h-20 object-cover group-hover:scale-110 transition-transform duration-500"
                    />
                    <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-primary/80 text-primary-foreground uppercase">
                      Live
                    </div>
                  </div>
                )}
                {(junction.referenceImageUrls || []).slice(0, 7).map((url, i) => (
                  <div key={url} className="relative rounded-lg overflow-hidden border border-border/40 group">
                    <img
                      src={url}
                      alt={`Previous ${i + 1}`}
                      className="w-full h-20 object-cover opacity-70 group-hover:opacity-100 group-hover:scale-110 transition-all duration-500"
                    />
                    <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded text-[9px] font-medium bg-black/70 text-muted-foreground">
                      −{i + 1}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </TerminalShell>
  );
}
