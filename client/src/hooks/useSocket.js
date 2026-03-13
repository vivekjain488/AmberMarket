import { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import { config } from "@/lib/config";

export function useSocket() {
  const socket = useMemo(
    () =>
      io(config.serverUrl, {
        transports: ["websocket"],
        autoConnect: true,
      }),
    []
  );

  const [connected, setConnected] = useState(socket.connected);
  const [hello, setHello] = useState(null);
  const [market, setMarket] = useState(null);
  const [counting, setCounting] = useState(null);
  const [settled, setSettled] = useState(null);

  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);

    socket.on("server:hello", (payload) => {
      setHello(payload);
      if (payload?.market) setMarket(payload.market);
    });
    socket.on("junction:state_change", (payload) => {
      setMarket((m) => ({ ...(m || {}), lastStateChange: payload }));
    });
    socket.on("oracle:counting", (payload) => setCounting(payload));
    socket.on("market:settled", (payload) => setSettled(payload));

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.disconnect();
    };
  }, [socket]);

  return { socket, connected, hello, market, counting, settled };
}

