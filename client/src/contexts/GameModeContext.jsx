import { createContext, useContext, useState, useEffect } from "react";
import { useSocket } from "@/hooks/useSocket";

const GameModeContext = createContext(null);

export function GameModeProvider({ children }) {
  const [isPracticeMode, setIsPracticeMode] = useState(false);
  const [practiceBalance, setPracticeBalance] = useState(10000);
  const [activePracticeBets, setActivePracticeBets] = useState({}); // { junctionId: [{betType, prediction, rangeMin, rangeMax, stake}] }
  const [practiceNotifications, setPracticeNotifications] = useState([]);

  const { socket, marketState } = useSocket();

  // Load from local storage on mount
  useEffect(() => {
    const saved = localStorage.getItem("ambermarket_practice_state");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (typeof parsed.balance === "number") setPracticeBalance(parsed.balance);
        if (parsed.activeBets) setActivePracticeBets(parsed.activeBets);
      } catch (e) {
        // ignore parse error
      }
    }
  }, []);

  // Save to local storage on change
  useEffect(() => {
    localStorage.setItem(
      "ambermarket_practice_state",
      JSON.stringify({ balance: practiceBalance, activeBets: activePracticeBets })
    );
  }, [practiceBalance, activePracticeBets]);

  // Listen for real event settlements to evaluate practice bets
  useEffect(() => {
    if (!socket) return;
    
    const handleSettled = ({ junctionId, finalCount }) => {
      const pendingBets = activePracticeBets[junctionId];
      if (!pendingBets || pendingBets.length === 0) return;

      let totalWinnings = 0;
      let totalStake = 0;

      pendingBets.forEach((bet) => {
        totalStake += bet.stake;
        let won = false;
        let multiplier = 0;

        if (bet.betType === "UNDER" && finalCount < bet.prediction) {
          won = true;
          multiplier = 1.8;
        } else if (bet.betType === "OVER" && finalCount > bet.prediction) {
          won = true;
          multiplier = 1.8;
        } else if (bet.betType === "RANGE" && finalCount >= bet.rangeMin && finalCount <= bet.rangeMax) {
          won = true;
          multiplier = 2.0;
        } else if (bet.betType === "EXACT") {
          const diff = Math.abs(finalCount - bet.prediction);
          if (diff <= 1) { won = true; multiplier = 5.0; } // Generous EXACT
          else if (diff <= 3) { won = true; multiplier = 2.0; }
        }

        if (won) {
          totalWinnings += bet.stake * multiplier;
        }
      });

      if (totalWinnings > 0) {
        setPracticeBalance((prev) => prev + totalWinnings);
        notify(`🎯 Practice Win! You earned ${totalWinnings.toFixed(0)} P-AMBER from ${totalStake} staked!`);
      } else {
        notify(`🎯 Practice Loss! Your ${totalStake} P-AMBER stake was lost. Better luck next round!`);
      }

      // Clear pending bets for this junction
      setActivePracticeBets((prev) => {
        const next = { ...prev };
        delete next[junctionId];
        return next;
      });
    };

    socket.on("market:settled", handleSettled);
    return () => socket.off("market:settled", handleSettled);
  }, [socket, activePracticeBets]);

  const placePracticeBet = (junctionId, betOpts) => {
    if (practiceBalance < betOpts.stake) {
      throw new Error("Insufficient Practice Balance");
    }
    setPracticeBalance((prev) => prev - betOpts.stake);
    
    setActivePracticeBets((prev) => {
      const existing = prev[junctionId] || [];
      return {
        ...prev,
        [junctionId]: [...existing, betOpts],
      };
    });
  };

  const refillPracticeBalance = () => {
    if (practiceBalance < 1000) {
      setPracticeBalance(10000);
      notify("🎯 P-AMBER balance refilled to 10,000!");
    }
  };

  const notify = (message) => {
    const id = Date.now();
    setPracticeNotifications((prev) => [...prev, { id, message }]);
    setTimeout(() => {
      setPracticeNotifications((prev) => prev.filter((n) => n.id !== id));
    }, 4000);
  };

  return (
    <GameModeContext.Provider
      value={{
        isPracticeMode,
        setIsPracticeMode,
        practiceBalance,
        placePracticeBet,
        activePracticeBets,
        refillPracticeBalance,
        practiceNotifications,
      }}
    >
      {children}
    </GameModeContext.Provider>
  );
}

export function useGameMode() {
  const context = useContext(GameModeContext);
  if (!context) {
    throw new Error("useGameMode must be used within a GameModeProvider");
  }
  return context;
}
