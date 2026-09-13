import { useEffect, useState, useRef, useCallback } from "react";
import confetti from "canvas-confetti";
import {
  Trophy, X, Car, Award,
  CheckCircle2, XCircle, Sparkles, Coins
} from "lucide-react";

/**
 * Settlement celebration popup.
 * Shows the final car count, winning range, user outcome, and fires confetti.
 */
export function SettlementModal({ settlement, userPrediction, onDismiss, onClaim }) {
  const [show, setShow] = useState(false);
  const [counting, setCounting] = useState(0);
  const confettiFired = useRef(false);

  const parsedFinalCount = Number(settlement?.finalCount);
  const finalCount = Number.isFinite(parsedFinalCount) ? parsedFinalCount : 0;
  const parsedToleranceLow = Number(settlement?.toleranceLow);
  const parsedToleranceHigh = Number(settlement?.toleranceHigh);

  // Some settlement events only provide finalCount. Fall back to ±1.
  const toleranceLow = Number.isFinite(parsedToleranceLow)
    ? parsedToleranceLow
    : Math.max(0, finalCount - 1);
  const toleranceHigh = Number.isFinite(parsedToleranceHigh)
    ? parsedToleranceHigh
    : finalCount + 1;

  // Compute prediction details
  let predictedDisplay = 0;
  let isWinner = false;
  let predLow = 0;
  let predHigh = 0;
    let predictedMarkerVal = 0;

    if (userPrediction) {
      if (typeof userPrediction === "object") {
        const type = userPrediction.betType;
        const val = Number(userPrediction.prediction);
        if (type === "UNDER") {
          predLow = 0;
          predHigh = val;
          predictedDisplay = `< ${val}`;
          isWinner = finalCount < val;
          predictedMarkerVal = val / 2;
        } else if (type === "OVER") {
          predLow = val;
          predHigh = val + 100; // arbitrary max visualization
          predictedDisplay = `> ${val}`;
          isWinner = finalCount > val;
          predictedMarkerVal = val + 5;
        } else if (type === "RANGE") {
          predLow = Number(userPrediction.rangeMin);
          predHigh = Number(userPrediction.rangeMax);
          predictedDisplay = `${predLow}-${predHigh}`;
          isWinner = finalCount >= predLow && finalCount <= predHigh;
          predictedMarkerVal = (predLow + predHigh) / 2;
        } else { // EXACT or default
          predLow = Math.max(0, val - 1);
          predHigh = val + 1;
          predictedDisplay = `${val}`;
          isWinner = Math.abs(finalCount - val) <= 1;
          predictedMarkerVal = val;
        }
      } else {
        predictedDisplay = Number(userPrediction) || 0;
        predictedMarkerVal = Number(userPrediction) || 0;
        isWinner = predictedDisplay >= toleranceLow && predictedDisplay <= toleranceHigh && predictedDisplay > 0;
      }
    }

  useEffect(() => {
    if (!settlement) {
      setShow(false);
      setCounting(0);
      confettiFired.current = false;
      return;
    }

    // Entrance animation
    const t1 = setTimeout(() => setShow(true), 100);

    // Count-up animation for the big number
    const target = finalCount;
    let current = 0;
    const step = Math.max(1, Math.ceil(target / 30));
    const countInterval = setInterval(() => {
      current = Math.min(target, current + step);
      setCounting(current);
      if (current >= target) {
        clearInterval(countInterval);
        // Fire confetti when count reaches final number
        if (!confettiFired.current) {
          confettiFired.current = true;
          fireConfetti(isWinner);
        }
      }
    }, 50);

    return () => {
      clearTimeout(t1);
      clearInterval(countInterval);
    };
  }, [settlement, finalCount, isWinner]);

  function fireConfetti(didWin) {
    if (!userPrediction) return; // If strictly inspecting, no bet means no confetti

    const colors = didWin 
      ? ["#10b981", "#34d399", "#d1fae5", "#ffffff"] // Green theme
      : ["#ef4444", "#f87171", "#fee2e2", "#ffffff"]; // Red theme

    // Main burst
    confetti({
      particleCount: 100,
      spread: 100,
      origin: { y: 0.5, x: 0.5 },
      colors: colors,
      gravity: 0.8,
      ticks: 200,
    });

    // Side cannons with staggered timing
    setTimeout(() => {
      confetti({
        particleCount: 60,
        angle: 60,
        spread: 55,
        origin: { x: 0, y: 0.65 },
        colors: colors,
      });
      confetti({
        particleCount: 60,
        angle: 120,
        spread: 55,
        origin: { x: 1, y: 0.65 },
        colors: colors,
      });
    }, 400);
  }

  function handleClose() {
    setShow(false);
    setTimeout(onDismiss, 300);
  }

  function handleActionClick() {
    if (isWinner && userPrediction && onClaim) {
      onClaim();
    }
    handleClose();
  }

  if (!settlement) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-[100] bg-black/70 backdrop-blur-md transition-opacity duration-500 ${show ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={handleClose}
      />

      {/* Modal */}
      <div className={`fixed inset-0 z-[101] flex items-center justify-center p-4 transition-all duration-700 ${show ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-90 translate-y-8 pointer-events-none'}`}>
        <div
          className="w-full max-w-md rounded-2xl border border-amber-500/20 shadow-2xl shadow-amber-500/10 overflow-hidden"
          style={{ background: "linear-gradient(135deg, rgba(15,15,30,0.98), rgba(20,20,40,0.98))" }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* ── Celebration Header ── */}
          <div className="relative overflow-hidden">
            {/* Animated gradient background */}
            <div className="absolute inset-0 bg-gradient-to-br from-amber-500/20 via-primary/15 to-emerald-500/10" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(245,158,11,0.3),transparent_70%)]" />

            {/* Floating particles */}
            <div className="absolute inset-0 overflow-hidden">
              {[...Array(6)].map((_, i) => (
                <div
                  key={i}
                  className="absolute h-1 w-1 rounded-full bg-amber-400/40"
                  style={{
                    left: `${15 + i * 15}%`,
                    animation: `float ${2 + i * 0.5}s ease-in-out infinite`,
                    animationDelay: `${i * 0.3}s`,
                    top: `${20 + (i % 3) * 20}%`,
                  }}
                />
              ))}
            </div>

            <div className="relative p-6 text-center">
              <button
                onClick={handleClose}
                className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-white/10 transition-colors text-muted-foreground hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>

              {/* Trophy icon with glow */}
              <div className="flex justify-center mb-4">
                <div className="relative">
                  <div className="absolute inset-0 rounded-2xl bg-amber-500/30 blur-xl animate-pulse" />
                  <div className="relative h-18 w-18 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-lg" style={{ height: "72px", width: "72px" }}>
                    <Trophy className="h-9 w-9 text-white drop-shadow-lg" />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-center gap-2 mb-1">
                <Sparkles className="h-4 w-4 text-amber-400" />
                <h2 className="text-xl font-extrabold tracking-tight">Round Complete!</h2>
                <Sparkles className="h-4 w-4 text-amber-400" />
              </div>
              <p className="text-sm text-muted-foreground">The oracle has counted the cars</p>
            </div>
          </div>

          {/* ── Body ── */}
          <div className="px-6 pb-2 space-y-5">
            {/* BIG Final Count with count-up animation */}
            <div className="text-center py-4">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">
                Cars Counted
              </div>
              <div className="relative inline-block">
                <div className="absolute inset-0 blur-2xl bg-amber-500/20 rounded-full" />
                <div
                  className="relative text-7xl font-black font-mono tabular-nums"
                  style={{
                    background: "linear-gradient(135deg, #f59e0b, #fbbf24, #f59e0b)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    textShadow: "0 0 40px rgba(245,158,11,0.3)",
                  }}
                >
                  {counting}
                </div>
              </div>
              <div className="flex items-center justify-center gap-1.5 mt-2 text-sm text-muted-foreground">
                <Car className="h-4 w-4" />
                vehicles detected
              </div>
            </div>

            {/* Winning Range Display */}
            <div className="rounded-xl p-4 border border-border/40" style={{ background: "rgba(255,255,255,0.03)" }}>
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-3 text-center">
                Winning Prediction Range
              </div>
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="text-center">
                  <div className="text-[10px] text-emerald-400/80 mb-1">Low</div>
                  <div className="text-xl font-bold font-mono text-emerald-400">{toleranceLow}</div>
                </div>
                <div className="text-center">
                  <div className="text-[10px] text-amber-400/80 mb-1">Actual</div>
                  <div className="text-xl font-bold font-mono text-primary">{finalCount}</div>
                </div>
                <div className="text-center">
                  <div className="text-[10px] text-emerald-400/80 mb-1">High</div>
                  <div className="text-xl font-bold font-mono text-emerald-400">{toleranceHigh}</div>
                </div>
              </div>

              {/* Visual range bar */}
              <div className="relative h-3 rounded-full bg-secondary/60 overflow-hidden">
                {/* Winning zone */}
                <div
                  className="absolute h-full rounded-full bg-gradient-to-r from-emerald-500/40 via-amber-500/50 to-emerald-500/40 transition-all duration-700"
                  style={{
                    left: `${Math.max(0, (toleranceLow / Math.max(toleranceHigh * 1.5, 50)) * 100)}%`,
                    width: `${((toleranceHigh - toleranceLow) / Math.max(toleranceHigh * 1.5, 50)) * 100}%`,
                  }}
                />
                {/* Actual count marker */}
                <div
                  className="absolute h-5 w-1 bg-amber-400 rounded-full -top-1 shadow-lg shadow-amber-500/30 transition-all duration-700"
                  style={{ left: `${(finalCount / Math.max(toleranceHigh * 1.5, 50)) * 100}%` }}
                />
                {/* User's prediction marker */}
                {predictedMarkerVal > 0 && (
                  <div
                    className={`absolute h-5 w-1 rounded-full -top-1 transition-all duration-700 ${isWinner ? 'bg-emerald-400 shadow-lg shadow-emerald-500/30' : 'bg-red-400 shadow-lg shadow-red-500/30'}`}
                    style={{ left: `${(predictedMarkerVal / Math.max(toleranceHigh * 1.5, 50)) * 100}%` }}
                    title={`Your prediction: ${predictedDisplay}`}
                  />
                )}
              </div>
              <div className="flex justify-between text-[9px] text-muted-foreground/40 font-mono mt-1">
                <span>0</span>
                <span>{Math.ceil(toleranceHigh * 1.5)}</span>
              </div>
            </div>

            {/* User Result */}
            {userPrediction && (
              <div className={`flex items-center gap-3 p-4 rounded-xl border transition-all duration-500 ${
                show ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
              } ${isWinner
                ? 'bg-emerald-500/10 border-emerald-500/30'
                : 'bg-red-500/10 border-red-500/30'
              }`}>
                {isWinner ? (
                  <>
                    <div className="h-10 w-10 rounded-xl bg-emerald-500/20 flex items-center justify-center shrink-0">
                      <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                    </div>
                    <div>
                      <div className="font-bold text-emerald-400">You Won! 🎉</div>
                      <div className="text-xs text-emerald-400/70 mt-0.5">
                        Your prediction of <span className="font-mono font-bold">{predictedDisplay}</span> was within [{toleranceLow}–{toleranceHigh}]. Claim your payout!
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="h-10 w-10 rounded-xl bg-red-500/20 flex items-center justify-center shrink-0">
                      <XCircle className="h-5 w-5 text-red-400" />
                    </div>
                    <div>
                      <div className="font-bold text-red-400">Not this time</div>
                      <div className="text-xs text-red-400/70 mt-0.5">
                        Your prediction of <span className="font-mono font-bold">{predictedDisplay}</span> was outside [{toleranceLow}–{toleranceHigh}]. Better luck next round!
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* ── Footer ── */}
          <div className="px-6 pb-6 pt-3">
            <button
              onClick={handleActionClick}
              className={`w-full py-3.5 rounded-xl font-bold text-sm transition-all duration-300 ${
                  isWinner && userPrediction
                    ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white hover:shadow-lg hover:shadow-emerald-500/20'
                    : 'bg-gradient-to-r from-primary to-amber-500 text-primary-foreground hover:shadow-lg hover:shadow-amber-500/20'
                } hover:scale-[1.01] active:scale-[0.99]`}
              >
                <span className="flex items-center justify-center gap-2">
                  {isWinner && userPrediction ? (
                  <>
                    <Coins className="h-4 w-4" />
                    Claim Winnings Now
                  </>
                ) : (
                  <>
                    <Award className="h-4 w-4" />
                    Next Round
                  </>
                )}
              </span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export default SettlementModal;
