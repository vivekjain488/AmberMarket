import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import Hls from "hls.js";
import {
  ArrowLeft, Camera, Car, Clock, DollarSign, Eye,
  Landmark, Signal, TrendingUp, Zap, Hash,
  AlertCircle, CheckCircle2, Loader2, ExternalLink,
  Minus, Plus, Coins, Scale, BarChart3, History, Radio,
  Send, Shield, Search, ZoomIn, Activity, Video, X, Lock
} from "lucide-react";

import { TerminalShell } from "@/components/TerminalShell";
import { StatusBadge } from "@/components/StatusBadge";
import { CountdownRing } from "@/components/CountdownRing";
import { PhaseIndicator } from "@/components/PhaseIndicator";
import { SettlementModal } from "@/components/SettlementModal";
import { PredictionModal } from "@/components/PredictionModal";
import { useSocket } from "@/hooks/useSocket";
import { useGameMode } from "@/contexts/GameModeContext";
import { useAccount, usePublicClient, useWalletClient, useChainId } from "wagmi";
import { parseUnits, formatUnits, keccak256, toBytes } from "viem";
import { config, getChainConfig } from "@/lib/config";
import { amberMarketAbi, erc20Abi, amberJunctionNftAbi } from "@/lib/amberMarketAbi";

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

function toJunctionBytes32(junctionId) {
  if (!junctionId) return null;
  if (/^0x[0-9a-fA-F]{64}$/.test(junctionId)) return junctionId;
  return keccak256(toBytes(junctionId));
}

const BET_TYPES = [
  { key: "UNDER", label: "🔽 Under", value: 0, desc: "Win if count < your number" },
  { key: "OVER",  label: "🔼 Over",  value: 1, desc: "Win if count > your number" },
  { key: "RANGE", label: "↔️ Range", value: 2, desc: "Win if count is in your range" },
  { key: "EXACT", label: "🎯 Exact", value: 3, desc: "Win if count ≈ your number (±1)" },
];

function estimatePayoutPreview({ betType, prediction, rangeMin, rangeMax, stake, poolTotal, carEstimate }) {
  const normalizedStake = Number(stake) || 0;
  const normalizedPool = Number(poolTotal) || 0;
  const estimate = Number(carEstimate) || 0;
  if (normalizedStake <= 0 || normalizedPool <= 0) return 0;

  let score = 0;
  if (betType === "UNDER" && estimate < prediction) {
    score = (prediction - estimate) / Math.max(1, prediction);
  } else if (betType === "OVER" && estimate > prediction) {
    score = (estimate - prediction) / Math.max(1, estimate);
  } else if (betType === "RANGE") {
    score = estimate >= rangeMin && estimate <= rangeMax ? 1.0 : 0.6;
  } else if (betType === "EXACT") {
    const diff = Math.abs(estimate - prediction);
    score = diff <= 1 ? 2.0 : diff <= 3 ? 0.75 : 0;
  }

  if (score <= 0) return 0;

  const playerWeight = normalizedStake * score;
  const estimatedFieldWeight = Math.max(playerWeight, normalizedPool * 0.75);
  const effectivePool = normalizedPool * 0.965;
  return (playerWeight / estimatedFieldWeight) * effectivePool;
}

function getRiskProfile({ betType, rangeMin, rangeMax }) {
  if (betType === "EXACT") {
    return { label: "HIGH", fill: 9 };
  }

  if (betType === "RANGE") {
    const width = Math.max(0, Number(rangeMax) - Number(rangeMin));
    if (width >= 10) return { label: "LOW", fill: 3 };
    if (width >= 6) return { label: "MODERATE", fill: 6 };
    return { label: "HIGH", fill: 8 };
  }

  return { label: "MODERATE", fill: 6 };
}

function renderRiskBar(fill) {
  const clamped = Math.max(0, Math.min(10, fill));
  return `${"█".repeat(clamped)}${"░".repeat(10 - clamped)}`;
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
  const chainId = useChainId();
  const chainConfig = getChainConfig(chainId);
  const { junctionId } = useParams();
  const {
    connected, hello,
    marketState: socketMarket,
    counting, settled,
    newSettlement, dismissSettlement,
    lastBet,
    annotatedFrame,
  } = useSocket();
  const { isPracticeMode, placePracticeBet } = useGameMode();

  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  /* ── Local state ── */
  const [junction, setJunction] = useState(null);
  const [restMarket, setRestMarket] = useState(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Prediction Modal state
  const [isPredictionModalOpen, setIsPredictionModalOpen] = useState(false);
  const [txStatus, setTxStatus] = useState(null);
  const [txLoading, setTxLoading] = useState(false);
  const [amberBalance, setAmberBalance] = useState(null);

  // On-chain pool data
  const [poolData, setPoolData] = useState(null);

  // Round history (kept locally from settlement events)
  const [roundHistory, setRoundHistory] = useState([]);
  
  // Live bets
  const [liveBets, setLiveBets] = useState([]);

  // NFT State
  const [junctionOwner, setJunctionOwner] = useState(null);
  const [myPoints, setMyPoints] = useState(0);
  const [nftPrice, setNftPrice] = useState("100");
  const [nftTxLoading, setNftTxLoading] = useState(false);
  const [nftTxStatus, setNftTxStatus] = useState(null);

  const ensureContractDeployed = useCallback(async (contractAddress, label) => {
    if (!publicClient) throw new Error("RPC client unavailable.");
    if (!contractAddress) throw new Error(`Missing ${label} address.`);
    const bytecode = await publicClient.getBytecode({ address: contractAddress });
    if (!bytecode || bytecode === "0x") {
      throw new Error(`${label} is not deployed on the currently connected network.`);
    }
  }, [publicClient]);

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
      // Clear live bets on settlement
      setLiveBets([]);
    }
  }, [settled]);

  /* ── Track socket live bets and resolve ENS ── */
  useEffect(() => {
    if (lastBet) {
      fetch(`${config.serverUrl}/api/ens/lookup/${lastBet.bettor}`)
        .then(r => r.json())
        .then(d => {
          setLiveBets(prev => [{ ...lastBet, ensName: d.name }, ...prev].slice(0, 15));
        })
        .catch(() => {
          setLiveBets(prev => [lastBet, ...prev].slice(0, 15));
        });
    }
  }, [lastBet]);

  /* ── On-chain pool data reader ── */
  useEffect(() => {
    if (!publicClient || !chainConfig.contractAddress) return;
    let cancelled = false;

    async function fetchPool() {
      try {
        const data = await publicClient.readContract({
          address: chainConfig.contractAddress,
          abi: amberMarketAbi,
          functionName: "getCurrentMarket",
        });
        if (!cancelled) {
          setPoolData({
            totalStaked: data.totalStaked,
            netPool: data.netPool,
            settlementCount: Number(data.settlementCount),
          });
        }
      } catch { /* demo mode */ }

      // Fetch AMBER balance
      if (address && chainConfig.amberTokenAddress) {
        try {
          const bal = await publicClient.readContract({
            address: chainConfig.amberTokenAddress,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [address],
          });
          if (!cancelled) setAmberBalance(bal);
        } catch { /* ignore */ }
      }
    }

    fetchPool();
    const t = setInterval(fetchPool, 8000);
    return () => { cancelled = true; clearInterval(t); };
}, [publicClient, chainConfig.contractAddress, phase, address, chainConfig.amberTokenAddress]);

  /* ── NFT Ownership & Gamified Pricing ── */
  useEffect(() => {
    if (!publicClient || !chainConfig.junctionNftAddress || !junctionId) return;

    let cancelled = false;
    async function fetchNftData() {
      try {
        const junctionKey = toJunctionBytes32(junctionId);
        if (!junctionKey) return;

        const ownerAddr = await publicClient.readContract({
          address: chainConfig.junctionNftAddress,
          abi: amberJunctionNftAbi,
          functionName: "getOwnerOfJunction",
          args: [junctionKey]
        });
        
        if (!cancelled) {
          if (ownerAddr !== "0x0000000000000000000000000000000000000000") {
            try {
              const res = await fetch(`${config.serverUrl}/api/ens/lookup/${ownerAddr}`);
              const data = await res.json();
              setJunctionOwner(data.name || `${ownerAddr.slice(0,6)}...${ownerAddr.slice(-4)}`);
            } catch {
              setJunctionOwner(`${ownerAddr.slice(0,6)}...${ownerAddr.slice(-4)}`);
            }
          } else {
            setJunctionOwner(null);
          }
        }

        // Fetch User Skills & Discounts
        if (address) {
          try {
            const discountPrice = await publicClient.readContract({
              address: chainConfig.junctionNftAddress,
              abi: amberJunctionNftAbi,
              functionName: "getDiscountedPrice",
              args: [junctionKey, address]
            });
            const currentPoints = await publicClient.readContract({
              address: chainConfig.contractAddress,
              abi: amberMarketAbi,
              functionName: "userPredictionPoints",
              args: [junctionKey, address]
            });
            if (!cancelled) {
              setNftPrice(formatUnits(discountPrice, 18));
              setMyPoints(Number(currentPoints));
            }
          } catch { /* ignore */ }
        }
      } catch (err) {
        console.error("NFT fetch error:", err);
      }
    }
    fetchNftData();
    const t = setInterval(fetchNftData, 15000);
    return () => { cancelled = true; clearInterval(t); };
  }, [publicClient, chainConfig.junctionNftAddress, junctionId, address]);

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
  const countdown = mergedMarket?.countdown || { predictionOpenMs: 60000, predictionLockMs: 5000, resolutionMs: 30000, rewardMs: 5000 };

  /* ── Time left (recomputed every tick) ── */
  const timeLeftMs = useMemo(() => {
    if (phase === "PREDICTION_OPEN") return msLeft(stateSinceMs, countdown.predictionOpenMs);
    if (phase === "PREDICTION_LOCKED") return msLeft(stateSinceMs, countdown.predictionLockMs);
    if (phase === "EVENT_RESOLUTION") return msLeft(stateSinceMs, countdown.resolutionMs);
    if (phase === "REWARD_DISTRIBUTION") return msLeft(stateSinceMs, countdown.rewardMs);
    return 0;
  }, [phase, stateSinceMs, countdown, nowMs]);

  const totalMs = useMemo(() => {
    if (phase === "PREDICTION_OPEN") return countdown.predictionOpenMs;
    if (phase === "PREDICTION_LOCKED") return countdown.predictionLockMs;
    if (phase === "EVENT_RESOLUTION") return countdown.resolutionMs;
    if (phase === "REWARD_DISTRIBUTION") return countdown.rewardMs;
    return 1;
  }, [phase, countdown]);

  const phaseLabel = useMemo(() => {
    switch (phase) {
      case "PREDICTION_OPEN": return "Betting Open";
      case "PREDICTION_LOCKED": return "Bets Locked";
      case "EVENT_RESOLUTION": return "Counting Cars";
      case "REWARD_DISTRIBUTION": return "Settling";
      case "IDLE": return "Starting…";
      default: return "Connecting…";
    }
  }, [phase]);

  const bettingOpen = phase === "PREDICTION_OPEN";

  /* ── Pool math in $AMBER (18 decimals) ── */
  const poolTotal = poolData?.totalStaked ? Number(formatUnits(poolData.totalStaked, 18)) : null;
  const poolNet = poolData?.netPool ? Number(formatUnits(poolData.netPool, 18)) : null;
  const balanceDisplay = amberBalance != null ? Number(formatUnits(amberBalance, 18)).toFixed(2) : null;

  /* ── Live data ── */
  const isServerActiveJunction = mergedMarket?.junctionId === junctionId;
  const currentCount = isServerActiveJunction ? (counting?.currentCount ?? restMarket?.python?.currentCount ?? 0) : 0;
  const frameCount = isServerActiveJunction ? (counting?.frameNumber ?? restMarket?.python?.frames ?? 0) : 0;
  const lastFinalCount = settled?.finalCount ?? mergedMarket?.lastSettlement?.finalCount;
  const lastLow = settled?.toleranceLow ?? mergedMarket?.lastSettlement?.toleranceLow;
  const lastHigh = settled?.toleranceHigh ?? mergedMarket?.lastSettlement?.toleranceHigh;

  const isAnnotatedForThisJunction = annotatedFrame?.junctionId === junctionId;
  const localAnnotatedFrame = isAnnotatedForThisJunction ? annotatedFrame : null;

  const userPredictionStr = typeof window !== 'undefined' ? localStorage.getItem('amber_lastBet_' + junctionId) : null;
  const userOpt = userPredictionStr ? JSON.parse(userPredictionStr) : null;

  const historicalEstimate = useMemo(() => {
    const counts = roundHistory
      .map((round) => Number(round?.finalCount))
      .filter((value) => Number.isFinite(value));
    if (counts.length === 0 && Number.isFinite(Number(lastFinalCount))) return Number(lastFinalCount);
    if (counts.length === 0) return 15;
    return counts.reduce((sum, value) => sum + value, 0) / counts.length;
  }, [roundHistory, lastFinalCount]);

  /* ═══════════════════════════════════════════════
     A C T I O N S
     ═══════════════════════════════════════════════ */

  async function placeBet(opts) {
    const { betType, prediction, rangeMin, rangeMax, stake } = opts;
    
    setTxStatus(null);
    if (!walletClient || !address) return setTxStatus("Connect wallet first.");

    if (isPracticeMode) {
      setTxLoading(true);
      try {
        await new Promise(r => setTimeout(r, 600)); // Simulate slight delay
        placePracticeBet(junctionId, opts);
        setTxStatus("✓ Practice bet recorded!");
        setTimeout(() => setIsPredictionModalOpen(false), 1500);
      } catch (e) {
        setTxStatus(e.message || "Practice bet failed");
      } finally {
        setTxLoading(false);
      }
      return;
    }

    if (!publicClient) return setTxStatus("RPC client unavailable.");
    if (!chainConfig.contractAddress) return setTxStatus("Missing contract address.");
    if (!chainConfig.amberTokenAddress) return setTxStatus("Missing $AMBER token address.");

    setTxLoading(true);
    try {
      const stakeAmount = parseUnits(stake || "0", 18);
      if (stakeAmount <= 0n) {
        setTxStatus("Stake must be greater than 0.");
        return;
      }

      const betTypeValue = BET_TYPES.find(b => b.key === betType)?.value ?? 0;
      const pred = betType === "RANGE" ? rangeMin : Number(prediction);
      const rMax = betType === "RANGE" ? rangeMax : 0;

      // Check network
      const currentChainId = await walletClient.getChainId();
      if (currentChainId !== 11155111 && currentChainId !== 84532) {
        return setTxStatus(`Switch wallet to Sepolia or Base Sepolia.`);
      }

      await ensureContractDeployed(chainConfig.amberTokenAddress, "$AMBER token contract");
      await ensureContractDeployed(chainConfig.contractAddress, "AmberMarket contract");

      // Approve $AMBER
      const allowance = await publicClient.readContract({
        address: chainConfig.amberTokenAddress,
        abi: erc20Abi,
        functionName: "allowance",
        args: [address, chainConfig.contractAddress],
      });

      if (allowance < stakeAmount) {
        setTxStatus("Approving $AMBER…");
        const approveHash = await walletClient.writeContract({
          address: chainConfig.amberTokenAddress,
          abi: erc20Abi,
          functionName: "approve",
          args: [chainConfig.contractAddress, stakeAmount],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
        setTxStatus("$AMBER approved! Placing bet…");
      }

      // Place bet with 4 args: betType, prediction, rangeMax, stakeAmount
      const hash = await walletClient.writeContract({
        address: chainConfig.contractAddress,
        abi: amberMarketAbi,
        functionName: "placeBet",
        args: [betTypeValue, pred, rMax, stakeAmount],
      });
      setTxStatus(`Bet submitted! Tx: ${hash.slice(0, 10)}…`);
      await publicClient.waitForTransactionReceipt({ hash });
      setTxStatus("✓ Bet confirmed on-chain!");
      setTimeout(() => setIsPredictionModalOpen(false), 2000);
    } catch (e) {
      setTxStatus(e?.shortMessage || e?.message || "Bet failed");
    } finally {
      setTxLoading(false);
    }
  }

  async function claim() {
    setTxStatus(null);
    if (!walletClient || !address) return setTxStatus("Connect wallet first.");
    
    if (isPracticeMode) {
      setTxStatus("Practice winnings are credited automatically.");
      return;
    }

    if (!chainConfig.contractAddress) return setTxStatus("Missing contract address.");

    setTxLoading(true);
    try {
      // Find the most recent market that is SETTLED and has an unclaimed bet
      const currentMarketId = await publicClient.readContract({
        address: chainConfig.contractAddress,
        abi: amberMarketAbi,
        functionName: "marketId",
      });

      let targetMarketId = null;
      // Check the last 10 markets
      for (let i = Number(currentMarketId); i > 0 && i >= Number(currentMarketId) - 10; i--) {
        const bet = await publicClient.readContract({
          address: chainConfig.contractAddress,
          abi: amberMarketAbi,
          functionName: "bets",
          args: [BigInt(i), address]
        });
        
        // bet: [bettor, betType, prediction, rangeMin, rangeMax, stakeAmount, claimed]
        // If they placed a bet and it's not claimed yet
        if (bet[5] > 0n && !bet[6]) {
          const m = await publicClient.readContract({
            address: chainConfig.contractAddress,
            abi: amberMarketAbi,
            functionName: "markets",
            args: [BigInt(i)]
          });
          // m.marketState is index 3 or so, but let's check if it's 2 (SETTLED)
          // struct: junctionId, marketState(1), predictionStart(2), predictionEnd(3), settlementCount(4), ...
          // Just check if it's 2
          if (m[1] === 2 || m[1] === 2n || Number(m[1]) === 2) {
             targetMarketId = BigInt(i);
             break;
          }
        }
      }

      if (!targetMarketId) {
        setTxStatus("No unclaimed winning bets found.");
        setTxLoading(false);
        return;
      }

      setTxStatus(`Claiming round #${targetMarketId.toString()}...`);
      const hash = await walletClient.writeContract({
        address: chainConfig.contractAddress,
        abi: amberMarketAbi,
        functionName: "claimWinnings",
        args: [targetMarketId],
      });
      setTxStatus(`Claim submitted! Tx: ${hash.slice(0, 10)}…`);
      await publicClient.waitForTransactionReceipt({ hash });
      setTxStatus("✓ Claim confirmed! You received your payout.");
    } catch (e) {
      setTxStatus(e?.shortMessage || e?.message || "Claim failed");
    } finally {
      setTxLoading(false);
    }
  }

  async function buyNft() {
    setNftTxStatus(null);
    if (!walletClient || !address) return setNftTxStatus("Connect wallet first.");
    if (!publicClient) return setNftTxStatus("RPC client unavailable.");
    if (!chainConfig.junctionNftAddress || !chainConfig.amberTokenAddress) return setNftTxStatus("Missing addresses.");
    const junctionKey = toJunctionBytes32(junctionId);
    if (!junctionKey) return setNftTxStatus("Invalid junction id.");

    setNftTxLoading(true);
    try {
      const currentChainId = await walletClient.getChainId();
      if (currentChainId !== 11155111 && currentChainId !== 84532) {
        setNftTxStatus(`Switch wallet to Sepolia or Base Sepolia.`);
        return;
      }

      await ensureContractDeployed(chainConfig.amberTokenAddress, "$AMBER token contract");
      await ensureContractDeployed(chainConfig.junctionNftAddress, "AmberJunctionNFT contract");

      const priceAmount = parseUnits(nftPrice, 18);
      const allowance = await publicClient.readContract({
        address: chainConfig.amberTokenAddress,
        abi: erc20Abi,
        functionName: "allowance",
        args: [address, chainConfig.junctionNftAddress],
      });

      if (allowance < priceAmount) {
        setNftTxStatus("Approving $AMBER...");
        const approveHash = await walletClient.writeContract({
          address: chainConfig.amberTokenAddress,
          abi: erc20Abi,
          functionName: "approve",
          args: [chainConfig.junctionNftAddress, priceAmount],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }

      setNftTxStatus("Purchasing Junction...");
      const hash = await walletClient.writeContract({
        address: chainConfig.junctionNftAddress,
        abi: amberJunctionNftAbi,
        functionName: "buyJunction",
        args: [junctionKey],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      setNftTxStatus("✓ Junction Acquired!");
      setJunctionOwner("You");
    } catch (e) {
      setNftTxStatus(e?.shortMessage || e?.message || "NFT purchase failed");
    } finally {
      setNftTxLoading(false);
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
        userPrediction={userOpt}
        onDismiss={dismissSettlement}
        onClaim={claim}
      />

      {/* ── Prediction Flow Replaced ── */}
      {/* Prediction now entirely happens on the Home page Map markers */}

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
            {junctionOwner ? (
              <div className="px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm font-bold font-mono shadow-lg shadow-emerald-500/5">
                👑 Owned by: <span className="text-white">{junctionOwner}</span>
              </div>
            ) : null}
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
                  bettingOpen ? "text-emerald-400" :
                  phase === "PREDICTION_LOCKED" ? "text-red-400" :
                  phase === "EVENT_RESOLUTION" ? "text-amber-400" :
                  phase === "REWARD_DISTRIBUTION" ? "text-primary" :
                  "text-muted-foreground"
                }`}>
                  {phaseLabel}
                </div>
              </div>
              {phase !== "PREDICTION_OPEN" && (
                <CountdownRing
                  timeLeftMs={timeLeftMs}
                  totalMs={totalMs}
                  size={80}
                  strokeWidth={4}
                />
              )}
            </div>

            {bettingOpen && (
              <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
                <Zap className="h-3.5 w-3.5" />
                Betting is open! Place your prediction now.
              </div>
            )}
            {phase === "PREDICTION_LOCKED" && (
              <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                <AlertCircle className="h-3.5 w-3.5" />
                Bets locked — counting starts soon.
              </div>
            )}
            {phase === "EVENT_RESOLUTION" && (
              <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                <Eye className="h-3.5 w-3.5" />
                Counting cars from CCTV feed…
              </div>
            )}
            {phase === "REWARD_DISTRIBUTION" && (
              <div className="flex items-center gap-2 text-xs text-primary bg-primary/10 border border-primary/20 rounded-lg px-3 py-2">
                <Landmark className="h-3.5 w-3.5" />
                Market settling — results momentarily.
              </div>
            )}
            {balanceDisplay && (
              <div className="flex items-center gap-2 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 mt-2">
                <Coins className="h-3.5 w-3.5" />
                Balance: <strong className="font-mono">{balanceDisplay} $AMBER</strong>
              </div>
            )}
          </div>

          {/* ── Prediction Instruction ── */}
          <div className="glass rounded-xl p-5 relative overflow-hidden group">
            <div className="absolute -inset-2 bg-gradient-to-r from-primary/20 via-amber-500/20 to-primary/20 opacity-0 group-hover:opacity-100 blur-xl transition-all duration-700 pointer-events-none" />
            
            <div className="relative z-10 flex flex-col items-center justify-center text-center space-y-3 py-2">
              <div className="h-12 w-12 rounded-full bg-primary/20 flex items-center justify-center mb-1">
                <TrendingUp className="h-6 w-6 text-primary" />
              </div>
              <h2 className="text-xl font-bold">Predict From Map</h2>
              <p className="text-sm text-muted-foreground pb-2 max-w-[280px]">
                Predictions and betting are now initiated directly from the map on the Home page.
              </p>
              
              <Link
                to="/"
                className="w-full py-4 rounded-xl font-bold text-lg text-center transition-all duration-300 bg-gradient-to-r from-primary to-amber-500 text-primary-foreground hover:shadow-lg hover:shadow-amber-500/20 hover:scale-[1.02] active:scale-[0.98]"
              >
                Go to Map
              </Link>

              <button className="w-full py-2.5 mt-2 rounded-xl font-medium text-sm transition-all duration-200 border border-border bg-secondary/40 text-foreground hover:bg-secondary/60 hover:border-primary/30 disabled:opacity-30 disabled:cursor-not-allowed" onClick={claim} disabled={txLoading}>
                <span className="flex items-center justify-center gap-2"><Coins className="h-4 w-4" /> Claim Winnings</span>
              </button>
            </div>
          </div>

          {/* ── Live Data ── */}
          <div className="grid grid-cols-2 gap-3">
            <DataTile icon={Car} label="Live Count" value={currentCount} accent sub={phase === "EVENT_RESOLUTION" ? "counting…" : ""} />
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

        {/* ── NFT Purchase Panel (God Mode) ── */}
        {!junctionOwner && (
          <div className="glass rounded-xl p-5 mb-4 relative overflow-hidden group">
            {/* Background Glow */}
            <div className="absolute -top-20 -right-20 w-40 h-40 bg-primary/10 rounded-full blur-3xl group-hover:bg-primary/20 transition-all duration-700" />
            
            <div className="flex items-center gap-2 mb-2 relative z-10">
              <Landmark className="h-5 w-5 text-amber-400" />
              <span className="text-sm font-bold bg-clip-text text-transparent bg-gradient-to-r from-amber-400 to-amber-200">
                Buy Real Estate NFT
              </span>
            </div>
            
            <p className="text-xs text-muted-foreground mb-4 relative z-10">
              Own this junction on the blockchain! As the landlord, you will instantly earn a <strong className="text-primary">0.5% protocol royalty</strong> on the entire betting volume every time a market settles here forever.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 items-center justify-between border-t border-border/30 pt-4 relative z-10">
              <div className="flex gap-4 w-full sm:w-auto">
                <div>
                  <div className="text-[10px] text-muted-foreground uppercase">Base Price</div>
                  <div className="line-through text-muted-foreground font-mono text-xs">100 $AMBER</div>
                </div>
                <div>
                  <div className="text-[10px] text-emerald-400 uppercase">Your Price</div>
                  <div className="font-mono font-bold text-emerald-400 text-xl">{Number(nftPrice).toFixed(0)} $AMBER</div>
                </div>
              </div>

              <div className="flex flex-col w-full sm:w-auto text-right">
                <button
                  className="px-6 py-2 rounded-xl bg-gradient-to-r from-emerald-500/20 to-primary/20 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/30 text-sm font-bold shadow-lg shadow-emerald-500/10 transition-all disabled:opacity-50"
                  onClick={buyNft}
                  disabled={nftTxLoading}
                >
                  {nftTxLoading ? "Purchasing..." : "Mint Real Estate"}
                </button>
                {myPoints > 0 && (
                  <span className="text-[10px] text-emerald-400 mt-1">
                    -{5 * myPoints}% skill discount applied ({myPoints} prediction wins)
                  </span>
                )}
                {nftTxStatus && (
                  <span className="text-[10px] text-amber-400 mt-1">{nftTxStatus}</span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Live Social Bets ── */}
        <div className="glass rounded-xl p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Radio className="h-4 w-4 text-primary animate-pulse" />
              <span className="text-sm font-semibold">Live Action</span>
            </div>
            {bettingOpen && <span className="text-[10px] text-emerald-400 bg-emerald-400/10 px-2 rounded-full uppercase">Accepting Bets</span>}
          </div>
          
          <div className="space-y-2 max-h-40 overflow-y-auto pr-2">
            {liveBets.length === 0 ? (
              <div className="text-xs text-muted-foreground text-center py-4">No bets placed this round yet. Be the first!</div>
            ) : (
              liveBets.map((b, i) => (
                <div key={`${b.bettor}-${i}`} className="flex justify-between items-center bg-secondary/30 p-2 rounded-lg border border-border/30 animate-fade-in text-xs">
                  <span className="font-mono font-bold text-amber-400">
                    {b.ensName || `${b.bettor.slice(0, 6)}...${b.bettor.slice(-4)}`}
                  </span>
                  <div className="text-muted-foreground flex items-center gap-1">
                    <span className="px-1 py-0.5 rounded bg-primary/15 text-primary text-[10px] font-bold">{b.betType || 'BET'}</span>
                    <strong className="text-primary font-mono">{Number(formatUnits(b.stakeAmount || '0', 18)).toFixed(0)} Ⓐ</strong>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

          {/* ── Round History ── */}
          {roundHistory.length > 0 && (
            <div className="glass rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <History className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold">Past Settlements</span>
                <span className="ml-auto text-[10px] text-muted-foreground font-mono">{roundHistory.length} rounds</span>
              </div>
              <div className="space-y-0 text-xs">
                {roundHistory.map((r, i) => (
                  <div key={`${r.finalCount}-${r.atMs || i}`} className="flex items-center justify-between gap-3 py-2 border-b border-border/30 last:border-0">
                    <div className="flex items-center gap-2">
                      <div className="h-5 w-5 rounded-md bg-primary/10 flex items-center justify-center">
                        <Car className="h-2.5 w-2.5 text-primary" />
                      </div>
                      <span className="font-mono font-medium text-foreground">{r.finalCount} cars</span>
                    </div>
                    <div className="font-mono text-muted-foreground">
                      [{r.toleranceLow}–{r.toleranceHigh}]
                    </div>
                  </div>
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
                {phase === "EVENT_RESOLUTION" && (
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
              {phase === "PREDICTION_OPEN" ? (
                <div className="h-[50vh] lg:h-[55vh] flex flex-col items-center justify-center p-6 bg-black/80">
                  <Lock className="h-10 w-10 text-amber-500/50 mb-4 animate-pulse" />
                  <p className="text-lg font-bold text-foreground">Live Stream Hidden</p>
                  <p className="text-sm text-muted-foreground mt-2 max-w-[300px] text-center">
                    A prediction must be placed on the Home map to unlock the live CCTV stream and trigger the counting phase.
                  </p>
                  <Link to="/" className="mt-6 px-6 py-2 bg-gradient-to-r from-emerald-500/20 to-primary/20 text-emerald-400 border border-emerald-500/30 rounded-lg text-sm font-bold shadow-lg hover:bg-emerald-500/30 transition-all">
                    Unlock on Map
                  </Link>
                </div>
              ) : localAnnotatedFrame ? (
                <div className="relative h-[50vh] lg:h-[55vh] w-full bg-black flex items-center justify-center">
                  <img
                    src={`data:image/jpeg;base64,${localAnnotatedFrame.frame}`}
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



