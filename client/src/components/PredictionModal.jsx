import { useState, useMemo } from "react";
import { formatUnits } from "viem";
import { 
  X, TrendingUp, Zap, AlertCircle, Loader2, Coins, Minus, Plus, Hash, CheckCircle2 
} from "lucide-react";

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
  if (betType === "EXACT") return { label: "HIGH", fill: 9 };
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

export function PredictionModal({ 
  isOpen, 
  onClose, 
  historicalEstimate, 
  poolTotal, 
  amberBalance,
  onPlaceBet,
  txLoading,
  txStatus
}) {
  const [betType, setBetType] = useState("UNDER");
  const [prediction, setPrediction] = useState(15);
  const [rangeMin, setRangeMin] = useState(10);
  const [rangeMax, setRangeMax] = useState(20);
  const [stake, setStake] = useState("10");

  const stakeNum = Number(stake) || 0;
  const estimatedPayout = useMemo(() => {
    return estimatePayoutPreview({
      betType,
      prediction: Number(prediction),
      rangeMin: Number(rangeMin),
      rangeMax: Number(rangeMax),
      stake: stakeNum,
      poolTotal,
      carEstimate: historicalEstimate,
    });
  }, [betType, prediction, rangeMin, rangeMax, stakeNum, poolTotal, historicalEstimate]);

  const riskProfile = useMemo(() => {
    return getRiskProfile({ betType, rangeMin, rangeMax });
  }, [betType, rangeMin, rangeMax]);

  const handleBetClick = () => {
    onPlaceBet({
      betType,
      prediction: Number(prediction),
      rangeMin: Number(rangeMin),
      rangeMax: Number(rangeMax),
      stake: stake,
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in zoom-in-95 duration-200">
      <div className="w-full max-w-md bg-secondary/90 border border-primary/30 rounded-2xl shadow-2xl overflow-hidden relative backdrop-blur-xl">
        {/* Glow */}
        <div className="absolute -top-32 -right-32 w-64 h-64 bg-primary/20 rounded-full blur-3xl pointer-events-none" />
        
        <div className="px-6 py-4 border-b border-border/50 flex items-center justify-between bg-background/50 relative z-10">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-bold">Configure Prediction</h2>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 relative z-10 space-y-5">
          {/* Bet Types */}
          <div className="grid grid-cols-4 gap-1 p-1 bg-background/50 rounded-xl border border-border/50">
            {BET_TYPES.map((bt) => (
              <button
                key={bt.key}
                onClick={() => setBetType(bt.key)}
                className={`py-2 px-1 rounded-lg text-xs font-semibold transition-all ${
                  betType === bt.key
                    ? 'bg-primary/20 text-primary border border-primary/30 shadow-md'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                }`}
              >
                {bt.label}
              </button>
            ))}
          </div>
          <div className="text-[11px] text-muted-foreground text-center -mt-2">
            {BET_TYPES.find(b => b.key === betType)?.desc}
            {betType === "EXACT" && <span className="ml-1 text-amber-400 font-bold">(🔥 2x WEIGHT)</span>}
          </div>

          {/* Inputs */}
          {(betType === "UNDER" || betType === "OVER" || betType === "EXACT") && (
            <div>
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-2">
                {betType === "UNDER" ? "Cars will be UNDER" : betType === "OVER" ? "Cars will be OVER" : "Exact car count"}
              </label>
              <div className="flex items-center gap-3">
                <button className="h-12 w-12 rounded-xl bg-background/50 border border-border flex items-center justify-center hover:bg-secondary hover:border-primary/50 text-foreground transition-all" onClick={() => setPrediction(Math.max(1, Number(prediction) - 1))} disabled={Number(prediction) <= 1}><Minus className="h-5 w-5" /></button>
                <div className="flex-1 relative">
                  <Hash className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                  <input className="w-full rounded-xl bg-background/50 border border-border pl-12 pr-4 py-3 font-mono text-2xl font-bold text-center text-foreground outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-all" type="number" value={prediction} onChange={(e) => setPrediction(Math.max(0, Math.min(200, Number(e.target.value) || 0)))} min={0} max={200} />
                </div>
                <button className="h-12 w-12 rounded-xl bg-background/50 border border-border flex items-center justify-center hover:bg-secondary hover:border-primary/50 text-foreground transition-all" onClick={() => setPrediction(Math.min(200, Number(prediction) + 1))} disabled={Number(prediction) >= 200}><Plus className="h-5 w-5" /></button>
              </div>
            </div>
          )}

          {betType === "RANGE" && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-2">Min count</label>
                <input className="w-full rounded-xl bg-background/50 border border-border px-4 py-3 font-mono text-xl font-bold text-center text-foreground outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-all" type="number" value={rangeMin} onChange={(e) => setRangeMin(Math.max(0, Math.min(200, Number(e.target.value) || 0)))} />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-2">Max count</label>
                <input className="w-full rounded-xl bg-background/50 border border-border px-4 py-3 font-mono text-xl font-bold text-center text-foreground outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-all" type="number" value={rangeMax} onChange={(e) => setRangeMax(Math.max(0, Math.min(200, Number(e.target.value) || 0)))} />
              </div>
            </div>
          )}

          {/* Quick picks */}
          <div>
            <div className="flex gap-2">
              {[5, 10, 15, 20, 30, 50].map((n) => (
                <button key={n} className="flex-1 py-2 rounded-lg text-xs font-mono font-bold transition-all bg-background/40 hover:bg-secondary border border-border/50 text-muted-foreground hover:text-foreground" onClick={() => betType === 'RANGE' ? (setRangeMin(n), setRangeMax(Math.min(200, n + 10))) : setPrediction(n)}>{n}</button>
              ))}
            </div>
          </div>

          {/* Stake */}
          <div className="p-4 rounded-xl bg-black/40 border border-border/50">
            <div className="flex justify-between items-center mb-2">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Stake Amount</label>
              {amberBalance != null && (
                <span className="text-[10px] text-amber-400 font-mono">Bal: {Number(formatUnits(amberBalance, 18)).toFixed(2)} Ⓐ</span>
              )}
            </div>
            <div className="relative">
              <Coins className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-amber-400" />
              <input className="w-full rounded-xl bg-background border border-border/50 pl-11 pr-4 py-3 font-mono text-lg font-bold text-foreground outline-none focus:border-primary/50 transition-colors" type="number" step="1" min="1" value={stake} onChange={(e) => setStake(e.target.value)} placeholder="10" />
            </div>
            <div className="flex gap-2 mt-3">
              {["10", "50", "100", "500", "MAX"].map((s) => (
                <button key={s} className="flex-1 py-1.5 rounded-md text-[10px] font-mono font-bold transition-all bg-secondary/80 hover:bg-secondary border border-border/50 text-foreground" onClick={() => setStake(s === "MAX" ? (amberBalance ? formatUnits(amberBalance, 18).split(".")[0] : "1000") : s)}>{s}</button>
              ))}
            </div>
          </div>

          {/* Estimate */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs bg-emerald-500/5 p-4 rounded-xl border border-emerald-500/20">
            <div className="flex justify-between col-span-2">
              <span className="text-muted-foreground">Local Pool Total</span>
              <span className="font-mono text-foreground">{poolTotal != null ? `${poolTotal.toFixed(2)} Ⓐ` : '—'}</span>
            </div>
            <div className="flex justify-between col-span-2">
              <span className="text-muted-foreground">Estimated Payout</span>
              <span className="font-mono font-bold text-emerald-400">{estimatedPayout > 0 ? `~${estimatedPayout.toFixed(2)} Ⓐ` : "—"}</span>
            </div>
            <div className="flex justify-between col-span-2 items-center">
              <span className="text-muted-foreground">Risk Profile</span>
              <span className="font-mono text-amber-300">{renderRiskBar(riskProfile.fill)} {riskProfile.label}</span>
            </div>
          </div>

          {/* Place Bet Submit */}
          <button
            onClick={handleBetClick}
            disabled={txLoading || stakeNum <= 0}
            className="w-full py-4 rounded-xl font-bold text-lg transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed bg-gradient-to-r from-primary to-amber-500 text-primary-foreground hover:shadow-lg hover:shadow-amber-500/20 hover:scale-[1.02] active:scale-[0.98] shadow-md shadow-primary/20"
          >
            {txLoading ? (
              <span className="flex items-center justify-center gap-2"><Loader2 className="h-5 w-5 animate-spin" /> Confirming Transaction…</span>
            ) : (
              <span className="flex items-center justify-center gap-2"><Zap className="h-5 w-5" /> Submit Prediction</span>
            )}
          </button>

          {txStatus && (
            <div className={`flex items-start gap-2 text-xs rounded-lg px-3 py-2.5 ${txStatus.includes("✓") ? 'text-emerald-400 bg-emerald-500/10 border border-emerald-500/20' : txStatus.includes("Tx:") ? 'text-amber-400 bg-amber-500/10 border border-amber-500/20' : 'text-red-400 bg-red-500/10 border border-red-500/20'}`}>
              {txStatus.includes("✓") ? <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" /> : <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />}
              <span className="break-all">{txStatus}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
