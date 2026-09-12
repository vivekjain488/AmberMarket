import { useEffect, useMemo, useState, useCallback } from "react";
import { io } from "socket.io-client";
import { config } from "@/lib/config";

let sharedSocket = null;

function getSocket() {
  if (!sharedSocket) {
    sharedSocket = io(config.serverUrl, {
      transports: ["polling", "websocket"],
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
  }
  return sharedSocket;
}

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
  const socket = useMemo(() => getSocket(), []);

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

    function onServerHello(payload) {
      setHello(payload);
      if (payload?.market) {
        setMarketState(payload.market);
      }
    }

    /* ── Phase transition — full snapshot from server ── */
    function onStateChange(payload) {
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
      if (payload.engineState === "PREDICTION_OPEN") {
        setCounting(null);
        setAnnotatedFrame(null);
      }
    }

    function onCounting(payload) {
      setCounting(payload);
    }

    function onAnnotatedFrame(payload) {
      setAnnotatedFrame(payload);
    }

    function onSettled(payload) {
      setSettled(payload);
      setNewSettlement(payload);
    }

    function onBetPlaced(payload) {
      setLastBet(payload);
    }

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("server:hello", onServerHello);
    socket.on("junction:state_change", onStateChange);

    /* ── Live counting ticks ── */
    socket.on("oracle:counting", onCounting);

    /* ── Annotated CV frames with bounding boxes ── */
    socket.on("oracle:annotated_frame", onAnnotatedFrame);

    /* ── Settlement ── */
    socket.on("market:settled", onSettled);

    /* ── Bet confirmations ── */
    socket.on("market:bet_placed", onBetPlaced);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("server:hello", onServerHello);
      socket.off("junction:state_change", onStateChange);
      socket.off("oracle:counting", onCounting);
      socket.off("oracle:annotated_frame", onAnnotatedFrame);
      socket.off("market:settled", onSettled);
      socket.off("market:bet_placed", onBetPlaced);
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
