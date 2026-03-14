import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { io } from "socket.io-client";
import { config } from "@/lib/config";

/**
 * Central socket hook — keeps real-time state in sync.
 *
 * Events from the server:
 *   server:hello          → initial snapshot
 *   junction:state_change → full snapshot on every phase transition
 *   oracle:counting       → { currentCount, frameNumber } ticks
 *   market:settled        → settlement result
 *   market:bet_placed     → on-chain bet confirmation
 *
 * Features:
 *   • Auto-reconnection with backoff
 *   • Re-fetches REST snapshot on reconnect to fill any gap
 *   • Exposes `newSettlement` + `dismissSettlement` for the popup
 */
export function useSocket() {
  const socket = useMemo(
    () =>
      io(config.serverUrl, {
        transports: ["websocket"],
        autoConnect: true,
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
      }),
    []
  );

  const [connected, setConnected] = useState(socket.connected);
  const [hello, setHello] = useState(null);
  const [marketState, setMarketState] = useState(null);
  const [counting, setCounting] = useState(null);
  const [settled, setSettled] = useState(null);
  const [newSettlement, setNewSettlement] = useState(null);
  const [lastBet, setLastBet] = useState(null);
  const [annotatedFrame, setAnnotatedFrame] = useState(null);

  // Re-fetch REST snapshot (used on reconnect to fill gap)
  const refetchSnapshot = useCallback(async () => {
    try {
      const res = await fetch(`${config.serverUrl}/api/market/_active`);
      if (res.ok) {
        const data = await res.json();
        setMarketState((prev) => ({ ...(prev || {}), ...data }));
      }
    } catch {
      // If /api/market/_active doesn't exist, try the generic endpoint
      try {
        const res2 = await fetch(`${config.serverUrl}/api/health`);
        if (res2.ok) {
          // Server is alive; the next server:hello will sync us
        }
      } catch { /* offline */ }
    }
  }, []);

  useEffect(() => {
    function onConnect() {
      setConnected(true);
      // On reconnect, re-fetch to fill any missed state changes
      refetchSnapshot();
    }
    function onDisconnect() {
      setConnected(false);
    }

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);

    /* ── Initial handshake ── */
    socket.on("server:hello", (payload) => {
      setHello(payload);
      if (payload?.market) {
        setMarketState(payload.market);
      }
    });

    /* ── Phase transition — full snapshot from server ── */
    socket.on("junction:state_change", (payload) => {
      setMarketState((prev) => ({
        ...(prev || {}),
        engineState: payload.engineState,
        stateSinceMs: payload.stateSinceMs,
        countdown: payload.countdown || prev?.countdown,
        marketId: payload.marketId ?? prev?.marketId,
        lastSettlement: payload.lastSettlement ?? prev?.lastSettlement,
        junctionId: payload.junctionId ?? prev?.junctionId,
      }));

      // New round → clear counting & annotated frame
      if (payload.engineState === "RED_OPEN") {
        setCounting(null);
        setAnnotatedFrame(null);
      }
    });

    /* ── Live counting ticks ── */
    socket.on("oracle:counting", (payload) => setCounting(payload));

    /* ── Annotated CV frames with bounding boxes ── */
    socket.on("oracle:annotated_frame", (payload) => setAnnotatedFrame(payload));

    /* ── Settlement ── */
    socket.on("market:settled", (payload) => {
      setSettled(payload);
      setNewSettlement(payload);
    });

    /* ── Bet confirmations ── */
    socket.on("market:bet_placed", (payload) => setLastBet(payload));

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.disconnect();
    };
  }, [socket, refetchSnapshot]);

  const dismissSettlement = useCallback(() => setNewSettlement(null), []);

  return {
    socket,
    connected,
    hello,
    marketState,
    counting,
    settled,
    newSettlement,
    dismissSettlement,
    lastBet,
    annotatedFrame,
  };
}
