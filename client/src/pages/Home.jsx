import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { GoogleMap, OverlayViewF, useJsApiLoader } from "@react-google-maps/api";
import {
  ArrowRight, MapPin, Signal, Zap, TrendingUp,
  Radio, ChevronRight, Eye, Clock, Car
} from "lucide-react";

import { TerminalShell } from "@/components/TerminalShell";
import { StatusBadge } from "@/components/StatusBadge";
import { ENSClaimModal } from "@/components/ENSClaimModal";
import { Leaderboard } from "@/components/Leaderboard";
import { useSocket } from "@/hooks/useSocket";
import { config, getChainConfig } from "@/lib/config";
import { amberJunctionNftAbi, amberMarketAbi } from "@/lib/amberMarketAbi";
import { formatUnits, keccak256, toBytes, parseUnits } from "viem";
import { useAccount, usePublicClient, useWalletClient, useChainId } from "wagmi";
import { erc20Abi } from "@/lib/amberMarketAbi";
import { PredictionModal } from "@/components/PredictionModal";
import { useGameMode } from "@/contexts/GameModeContext";

/* ═══════════════════════════════════════════════
   G O O G L E   M A P S   D A R K   S T Y L E
   ═══════════════════════════════════════════════ */

const mapDarkStyle = [
  { elementType: "geometry", stylers: [{ color: "#1a1a2e" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#1a1a2e" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#6b7280" }] },
  { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#9ca3af" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#252540" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#1e1e36" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#2d2d4a" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0e0e1a" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#4a5568" }] },
  { featureType: "poi", elementType: "geometry", stylers: [{ color: "#1e1e36" }] },
  { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#6b7280" }] },
  { featureType: "transit", elementType: "geometry", stylers: [{ color: "#1e1e36" }] },
];

/* ═══════════════════════════════════════════════
   S T A T   C A R D
   ═══════════════════════════════════════════════ */

function StatCard({ icon: Icon, label, value, accent = false }) {
  return (
    <div className="glass rounded-xl p-4 flex items-center gap-3 animate-fade-in-up">
      <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${accent ? 'bg-primary/15 text-primary' : 'bg-secondary text-muted-foreground'}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{label}</div>
        <div className={`text-lg font-bold font-mono ${accent ? 'text-primary' : 'text-foreground'}`}>{value}</div>
      </div>
    </div>
  );
}

function toJunctionBytes32(junctionId) {
  if (!junctionId) return null;
  if (/^0x[0-9a-fA-F]{64}$/.test(junctionId)) return junctionId;
  return keccak256(toBytes(junctionId));
}

/* ═══════════════════════════════════════════════
   J U N C T I O N   C A R D
   ═══════════════════════════════════════════════ */

function JunctionCard({ junction, isActive, livePhase, timeLeftSec, publicClient, activePoolAmber, onPredict }) {
  const jcChainId = useChainId();
  const chainConfig = getChainConfig(jcChainId);
  const [ownerEns, setOwnerEns] = useState(null);
  
  // Resolve owner from NFT, then to ENS
  useEffect(() => {
    async function fetchOwner() {
      if (!chainConfig.junctionNftAddress || !publicClient) return;
      try {
        const junctionKey = toJunctionBytes32(junction.id);
        if (!junctionKey) {
          setOwnerEns("Unowned");
          return;
        }

        const ownerAddr = await publicClient.readContract({
          address: chainConfig.junctionNftAddress,
          abi: amberJunctionNftAbi,
          functionName: "getOwnerOfJunction",
          args: [junctionKey]
        });
        if (ownerAddr && ownerAddr !== "0x0000000000000000000000000000000000000000") {
          const res = await fetch(`${config.serverUrl}/api/ens/lookup/${ownerAddr}`);
          const data = await res.json();
          setOwnerEns(data.name || `${ownerAddr.slice(0, 6)}...${ownerAddr.slice(-4)}`);
        } else {
          setOwnerEns("Unowned");
        }
      } catch (err) {
        setOwnerEns("Unowned");
      }
    }
    fetchOwner();
  }, [junction.id, publicClient]);

  return (
    <button
      onClick={() => onPredict(junction)}
      className="text-left w-full group block glass rounded-xl overflow-hidden transition-all duration-300 hover:border-primary/30 hover:shadow-lg hover:shadow-amber-500/5 glass-hover"
    >
      {/* Thumbnail / Preview */}
      <div className="relative h-32 bg-gradient-to-br from-secondary to-background overflow-hidden">
        {junction.currentImageURL ? (
          <img
            src={junction.currentImageURL + "?t=" + Math.floor(Date.now() / 30000)}
            alt={junction.name}
            className="w-full h-full object-cover opacity-60 group-hover:opacity-80 group-hover:scale-105 transition-all duration-500"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <MapPin className="h-8 w-8 text-muted-foreground/30" />
          </div>
        )}

        {/* Overlay gradient */}
        <div className="absolute inset-0 bg-gradient-to-t from-card via-transparent to-transparent" />

        {/* Status badge */}
        <div className="absolute top-3 left-3">
          {isActive ? (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-[10px] font-semibold uppercase tracking-wider">
              <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-secondary/60 border border-border/50 text-muted-foreground text-[10px] font-semibold uppercase tracking-wider">
              <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
              Ready
            </div>
          )}
        </div>

        {/* Multiplier badge */}
        <div className="absolute top-3 right-3">
          <div className="px-2 py-1 rounded-lg bg-primary/20 border border-primary/30 text-primary text-xs font-bold font-mono">
            {junction.multiplier_tier}x
          </div>
        </div>

        {/* Live phase + timer on active junction */}
        {isActive && livePhase && (
          <div className="absolute bottom-2 right-2 flex flex-col items-end gap-1">
            {livePhase === "EVENT_RESOLUTION" && liveCarCount != null && (
              <div className="px-2 py-1 rounded-lg bg-emerald-500/20 backdrop-blur-sm border border-emerald-500/30 text-emerald-400 flex items-center gap-1.5 animate-pulse">
                <Car className="h-3 w-3" />
                <span className="text-[10px] font-mono font-bold">
                  Cars: {liveCarCount}
                </span>
              </div>
            )}
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-black/60 backdrop-blur-sm border border-border/30">
              <Clock className="h-3 w-3 text-primary" />
              <span className="text-[10px] font-mono font-bold text-primary">
                {livePhase === "PREDICTION_OPEN" ? "Betting" : livePhase === "EVENT_RESOLUTION" ? "Counting" : livePhase === "PREDICTION_LOCKED" ? "Locked" : "Settling"}
              </span>
              {timeLeftSec != null && (
                <span className="text-[10px] font-mono text-foreground">{timeLeftSec}s</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-4">
        <h3 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors line-clamp-1">
          {junction.name}
        </h3>
        <p className="mt-1 text-xs text-muted-foreground line-clamp-1">
          {junction.description}
        </p>

        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 text-xs text-muted-foreground bg-secondary/80 px-2 py-1 rounded">
              <span className="font-mono text-[10px] text-amber-400">Owner:</span> 
              <span className="font-mono font-medium truncate max-w-[100px]">{ownerEns || "Loading..."}</span>
            </div>
            {isActive && activePoolAmber != null && (
              <div className="flex items-center gap-1 text-xs text-primary bg-primary/10 border border-primary/20 px-2 py-1 rounded">
                <span className="font-mono text-[10px]">Pool:</span>
                <span className="font-mono font-semibold">{activePoolAmber.toFixed(2)} Ⓐ</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1 text-xs font-medium text-primary opacity-0 group-hover:opacity-100 transition-opacity duration-300">
            Predict <ChevronRight className="h-3 w-3" />
          </div>
        </div>
      </div>
    </button>
  );
}

/* ═══════════════════════════════════════════════
   H O M E   P A G E
   ═══════════════════════════════════════════════ */

export function Home() {
  const chainId = useChainId();
  const chainConfig = getChainConfig(chainId);
  const navigate = useNavigate();
  const { data: walletClient } = useWalletClient();
  const { isConnected, address } = useAccount();
  const publicClient = usePublicClient();
  const [junctions, setJunctions] = useState([]);
  const [activeJunctionId, setActiveJunctionId] = useState(null);
  const [activePoolAmber, setActivePoolAmber] = useState(null);
  const [showEnsModal, setShowEnsModal] = useState(false);
  const [myEns, setMyEns] = useState(null);
  const [faucetLoading, setFaucetLoading] = useState(false);
  const [amberBalance, setAmberBalance] = useState(null);
  const [selectedJunctionForBet, setSelectedJunctionForBet] = useState(null);
  const [isPredictionModalOpen, setIsPredictionModalOpen] = useState(false);
  const [txStatus, setTxStatus] = useState(null);
  const [txLoading, setTxLoading] = useState(false);
  const { isPracticeMode, placePracticeBet } = useGameMode();

  const refreshRef = useRef(null);

  useEffect(() => {
    if (!publicClient || !address || !chainConfig.amberTokenAddress) {
      setAmberBalance(null);
      return;
    }
    const fetchBalance = async () => {
      try {
        const bal = await publicClient.readContract({
          address: chainConfig.amberTokenAddress, abi: erc20Abi, functionName: "balanceOf", args: [address]
        });
        setAmberBalance(bal);
      } catch { setAmberBalance(null); }
    };
    fetchBalance();
    const intv = setInterval(fetchBalance, 10000);
    return () => clearInterval(intv);
  }, [publicClient, address, chainConfig.amberTokenAddress]);

  const handlePredictClick = (junction) => {
    setSelectedJunctionForBet(junction);
    setIsPredictionModalOpen(true);
    setTxStatus(null);
  };

  const handlePlaceBet = async (opts) => {
    if (!selectedJunctionForBet) return;
    const { betType, prediction, rangeMin, rangeMax, stake } = opts;
    
    setTxStatus(null);
    if (!walletClient || !address) return setTxStatus("Connect wallet first.");

    if (isPracticeMode) {
      setTxLoading(true);
      try {
        await new Promise(r => setTimeout(r, 600)); // Simulate slight delay
        placePracticeBet(selectedJunctionForBet.id, opts);
        localStorage.setItem('amber_lastBet_' + selectedJunctionForBet.id, JSON.stringify(opts));
        setTxStatus("✓ Practice bet recorded!");
        // Hit backend API to trigger EVENT_RESOLUTION countdown
        fetch(`${config.serverUrl}/api/market/start-count`, { method: "POST" }).catch(() => {});
        setTimeout(() => {
          setIsPredictionModalOpen(false);
          navigate(`/market/${selectedJunctionForBet.id}`);
        }, 1500);
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
      if (stakeAmount <= 0n) return setTxStatus("Stake > 0 required.");

      const BET_TYPES = { "UNDER": 0, "OVER": 1, "RANGE": 2, "EXACT": 3 };
      const betTypeValue = BET_TYPES[betType] ?? 0;
      const pred = betType === "RANGE" ? rangeMin : Number(prediction);
      const rMax = betType === "RANGE" ? rangeMax : 0;

      const currentChainId = await walletClient.getChainId();
      if (currentChainId !== 11155111 && currentChainId !== 84532) {
        return setTxStatus(`Switch wallet to Sepolia or Base Sepolia.`);
      }

      const allowance = await publicClient.readContract({
        address: chainConfig.amberTokenAddress, abi: erc20Abi, functionName: "allowance", args: [address, chainConfig.contractAddress],
      });

      if (allowance < stakeAmount) {
        setTxStatus("Approving $AMBER…");
        const approveHash = await walletClient.writeContract({
          address: chainConfig.amberTokenAddress, abi: erc20Abi, functionName: "approve", args: [chainConfig.contractAddress, stakeAmount],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
        setTxStatus("$AMBER approved! Placing bet…");
      }

      setTxStatus("Submitting bet to contract…");
      const hash = await walletClient.writeContract({
        address: chainConfig.contractAddress, abi: amberMarketAbi, functionName: "placeBet", args: [betTypeValue, pred, rMax, stakeAmount],
      });
      setTxStatus(`Bet submitted! Tx: ${hash.slice(0, 10)}…`);
      await publicClient.waitForTransactionReceipt({ hash });
      setTxStatus("✓ Bet confirmed on-chain!");

      localStorage.setItem('amber_lastBet_' + selectedJunctionForBet.id, JSON.stringify(opts));

      // Hit backend API to trigger EVENT_RESOLUTION countdown
      await fetch(`${config.serverUrl}/api/market/start-count`, { method: "POST" });

      setTimeout(() => {
        setIsPredictionModalOpen(false);
        navigate(`/market/${selectedJunctionForBet.id}`);
      }, 1500);
      
    } catch (e) {
      setTxStatus(e?.shortMessage || e?.message || "Bet failed");
    } finally {
      setTxLoading(false);
    }
  };

  const claimFaucet = async () => {
    if (!address) return;
    setFaucetLoading(true);
    try {
      const res = await fetch(`${config.serverUrl}/api/amber/faucet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, chainId })
      });
      const data = await res.json();
      if (res.ok) {
        if (typeof data.balance === "string") {
          setAmberBalance(parseUnits(data.balance, 18));
        }
        const txText = data.txHash ? ` Tx: ${data.txHash.slice(0, 10)}…` : "";
        alert(`Success! Claimed 1000 $AMBER from faucet.${txText}`);
      } else {
        alert("Faucet error: " + data.error);
      }
    } catch (err) {
      alert("Failed to hit faucet: " + err.message);
    } finally {
      setFaucetLoading(false);
    }
  };

  // Socket for real-time updates
  const { connected, marketState, counting } = useSocket();

  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: config.googleMapsApiKey || "",
  });

  // Fetch junctions from server
  const fetchJunctions = useCallback(async () => {
    try {
      const res = await fetch(`${config.serverUrl}/api/junctions`);
      const data = await res.json();
      setJunctions(data.junctions || []);
      setActiveJunctionId(data.activeJunctionId || null);
    } catch (err) {
      console.error("Failed to fetch junctions:", err);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchJunctions();
  }, [fetchJunctions]);

  // Auto-refresh junctions every 15 seconds to keep thumbnails & status fresh
  useEffect(() => {
    refreshRef.current = setInterval(fetchJunctions, 15000);
    return () => clearInterval(refreshRef.current);
  }, [fetchJunctions]);

  // Check if user has an ENS name yet
  useEffect(() => {
    if (!isConnected || !address) {
      setMyEns(null);
      return;
    }

    let cancelled = false;

    async function loadEnsName() {
      try {
        const lookupRes = await fetch(`${config.serverUrl}/api/ens/lookup/${address}`);
        const lookupData = await lookupRes.json();
        if (cancelled) return;

        if (lookupData?.name) {
          setMyEns(lookupData.name);
          return;
        }
      } catch {
        // fall through to local verification
      }

      try {
        const savedLabel = typeof window !== "undefined"
          ? localStorage.getItem("amber_lastEnsLabel")
          : null;

        if (!savedLabel) {
          if (!cancelled) setMyEns(null);
          return;
        }

        const verifyRes = await fetch(`${config.serverUrl}/api/ens/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label: savedLabel, address }),
        });

        const verifyData = await verifyRes.json();
        if (cancelled) return;

        if (verifyRes.ok && verifyData?.verified && verifyData?.name) {
          setMyEns(verifyData.name);
        } else {
          setMyEns(null);
          if (typeof window !== "undefined") {
            localStorage.removeItem("amber_lastEnsLabel");
          }
        }
      } catch {
        if (!cancelled) setMyEns(null);
      }
    }

    loadEnsName();
    return () => {
      cancelled = true;
    };
  }, [isConnected, address]);

  // When socket tells us the phase changed, re-fetch to stay in sync
  useEffect(() => {
    if (marketState?.engineState) {
      fetchJunctions();
    }
  }, [marketState?.engineState, fetchJunctions]);

  // Read active pool size (total staked) for active junction card
  useEffect(() => {
    if (!publicClient || !chainConfig.contractAddress) {
      setActivePoolAmber(null);
      return;
    }

    let cancelled = false;
    async function fetchActivePool() {
      try {
        const market = await publicClient.readContract({
          address: chainConfig.contractAddress,
          abi: amberMarketAbi,
          functionName: "getCurrentMarket",
        });

        if (!cancelled) {
          setActivePoolAmber(Number(formatUnits(market.totalStaked ?? 0n, 18)));
        }
      } catch {
        if (!cancelled) setActivePoolAmber(null);
      }
    }

    fetchActivePool();
    const interval = setInterval(fetchActivePool, 10000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [publicClient, marketState?.engineState, chainConfig.contractAddress]);

  // Derive live phase info from socket for the active junction card
  const livePhase = marketState?.engineState || null;
  const liveTimeLeftSec = useMemo(() => {
    if (!marketState?.stateSinceMs || !marketState?.countdown) return null;
    const { engineState, stateSinceMs, countdown } = marketState;
    let durationMs = 0;
    if (engineState === "PREDICTION_OPEN") durationMs = countdown.predictionOpenMs;
    else if (engineState === "PREDICTION_LOCKED") durationMs = countdown.predictionLockMs;
    else if (engineState === "EVENT_RESOLUTION") durationMs = countdown.resolutionMs;
    else if (engineState === "REWARD_DISTRIBUTION") durationMs = countdown.rewardMs;
    else return null;
    const left = Math.max(0, durationMs - (Date.now() - stateSinceMs));
    return Math.ceil(left / 1000);
  }, [marketState]);

  // Re-compute timer every second
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Live car count from counting events
  const liveCarCount = counting?.currentCount ?? null;

  const center = useMemo(() => {
    if (junctions.length > 0 && junctions[0].lat != null && junctions[0].lng != null) {
      return { lat: junctions[0].lat, lng: junctions[0].lng };
    }
    return { lat: 38.58, lng: -121.49 };
  }, [junctions]);

  return (
    <TerminalShell
      right={
        <StatusBadge
          connected={connected}
          label={connected ? "Live" : "Offline"}
        />
      }
    >
      {showEnsModal && (
        <ENSClaimModal 
          onClose={() => setShowEnsModal(false)} 
          onSuccess={(name) => setMyEns(name)} 
        />
      )}

      {/* Prediction Modal */}
      <PredictionModal
        isOpen={isPredictionModalOpen}
        onClose={() => setIsPredictionModalOpen(false)}
        historicalEstimate={15}
        poolTotal={activePoolAmber != null ? activePoolAmber : 0}
        amberBalance={amberBalance}
        onPlaceBet={handlePlaceBet}
        txLoading={txLoading}
        txStatus={txStatus}
      />

      {/* ── Hero Section ── */}
      <section className="relative mb-8 animate-fade-in">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
          <div>
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
              Every Signal is a{" "}
              <span className="text-gradient-amber">Market</span>
            </h1>
            <p className="mt-2 text-muted-foreground max-w-xl text-sm sm:text-base leading-relaxed">
              Predict the number of cars crossing a junction during a green-light window.
              Stake $AMBER, watch the live CCTV feed, and win from the pool.
            </p>
          </div>
          <div className="flex flex-col gap-2 relative z-10">
            <div className="flex items-center gap-2">
              <div className="px-4 py-2 rounded-xl glass text-xs font-medium text-primary flex items-center gap-2">
                <Zap className="h-3.5 w-3.5" />
                Powered by Base Sepolia
              </div>
            </div>
            {isConnected && !myEns && (
              <button
                onClick={() => setShowEnsModal(true)}
                className="px-4 py-2 mt-2 sm:mt-0 rounded-xl bg-gradient-to-r from-emerald-500/20 to-blue-500/20 border border-emerald-500/30 text-emerald-400 text-xs font-bold uppercase tracking-wider hover:bg-emerald-500/30 transition-all font-mono shadow-lg shadow-emerald-500/10 flex items-center justify-center gap-2 w-full sm:w-auto"
              >
                Mint your .eth Identity 🎁
              </button>
            )}
            {isConnected && myEns && (
              <div className="px-4 py-2 mt-2 sm:mt-0 rounded-xl bg-primary/10 border border-primary/20 text-primary text-xs font-bold font-mono text-center w-full sm:w-auto">
                God Mode Active: {myEns}
              </div>
            )}
            {isConnected && (
              <button
                onClick={claimFaucet}
                disabled={faucetLoading}
                className="px-4 py-2 mt-2 rounded-xl bg-amber-500/20 border border-amber-500/30 text-amber-500 text-xs font-bold uppercase tracking-wider hover:bg-amber-500/30 transition-all font-mono flex items-center justify-center gap-2 w-full sm:w-auto disabled:opacity-50"
              >
                {faucetLoading ? "Mining..." : "Claim 1000 $AMBER Faucet"}
              </button>
            )}
          </div>
        </div>
      </section>

      {/* ── Stats Row ── */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        <StatCard icon={MapPin} label="Junctions" value={junctions.length} accent />
        <StatCard icon={Radio} label="Active" value={activeJunctionId ? "1" : "0"} />
        <StatCard icon={Eye} label="CCTV Feeds" value={junctions.filter(j => j.stream_url).length} />
        <StatCard
          icon={Car}
          label="Live Count"
          value={liveCarCount != null ? liveCarCount : "—"}
          accent
        />
      </section>

      {/* ── Map + Junction List ── */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
        {/* Map */}
        <div className="glass rounded-xl overflow-hidden animate-fade-in-up">
          <div className="px-4 py-3 border-b border-border/40 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">Live Map</span>
            </div>
            <span className="text-xs text-muted-foreground font-mono">
              {junctions.length} junction{junctions.length !== 1 ? 's' : ''}
            </span>
          </div>

          {!config.googleMapsApiKey ? (
            <div className="p-8 text-center">
              <MapPin className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                Set <code className="px-1.5 py-0.5 rounded bg-secondary text-primary font-mono text-xs">VITE_GOOGLE_MAPS_API_KEY</code> to enable the map
              </p>
            </div>
          ) : loadError ? (
            <div className="p-8 text-center text-red-400 text-sm">Google Maps failed to load.</div>
          ) : !isLoaded ? (
            <div className="p-8 text-center">
              <div className="h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Loading map…</p>
            </div>
          ) : (
            <GoogleMap
              mapContainerStyle={{ width: "100%", height: "60vh", minHeight: "400px" }}
              center={center}
              zoom={12}
              options={{
                mapTypeControl: false,
                streetViewControl: false,
                fullscreenControl: false,
                styles: mapDarkStyle,
                backgroundColor: "#1a1a2e",
              }}
            >
              {junctions.map((j) => (
                <OverlayViewF
                  key={j.id}
                  position={{ lat: j.lat, lng: j.lng }}
                  mapPaneName={OverlayViewF.OVERLAY_MOUSE_TARGET}
                >
                  <div 
                    className="flex flex-col items-center -translate-x-1/2 -translate-y-1/2 group cursor-pointer relative"
                    title={`${j.name} (${j.multiplier_tier}x tier)`}
                    onClick={() => handlePredictClick(j)}
                  >
                    <div className="absolute inset-0 bg-amber-500/20 rounded-full blur-md group-hover:bg-amber-500/40 transition-colors" />
                    <div className="bg-amber-500 rounded-full h-4 w-4 border-2 border-[#1a1a2e] shadow-lg group-hover:scale-125 transition-transform relative z-10" />
                    <span className="mt-1 px-1.5 py-0.5 bg-[#1a1a2e]/90 backdrop-blur-sm rounded border border-amber-500/30 text-[10px] font-mono font-bold text-amber-500 whitespace-nowrap shadow-xl relative z-10">
                      {j.multiplier_tier}x
                    </span>
                  </div>
                </OverlayViewF>
              ))}
            </GoogleMap>
          )}
        </div>

        {/* Junction List */}
        <div className="space-y-3 animate-fade-in-up delay-200">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Signal className="h-4 w-4 text-primary" />
              Available Markets
            </h2>
            <span className="text-xs text-muted-foreground font-mono">{junctions.length} total</span>
          </div>

          <div className="space-y-3 max-h-[calc(60vh+40px)] overflow-y-auto pr-1">
            {junctions.map((j) => (
              <JunctionCard
                key={j.id}
                junction={j}
                isActive={j.id === activeJunctionId}
                livePhase={j.id === activeJunctionId ? livePhase : null}
                timeLeftSec={j.id === activeJunctionId ? liveTimeLeftSec : null}
                publicClient={publicClient}
                activePoolAmber={j.id === activeJunctionId ? activePoolAmber : null}
                onPredict={handlePredictClick}
              />
            ))}

            {junctions.length === 0 && (
              <div className="glass rounded-xl p-8 text-center">
                <MapPin className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No junctions available</p>
                <p className="text-xs text-muted-foreground/60 mt-1">Start the server to load CCTV data</p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── Leaderboard ── */}
      <Leaderboard />
    </TerminalShell>
  );
}




