import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { GoogleMap, MarkerF, useJsApiLoader } from "@react-google-maps/api";

import { TerminalShell } from "@/components/TerminalShell";
import { config } from "@/lib/config";

export function Home() {
  const [junctions, setJunctions] = useState([]);
  const [activeJunctionId, setActiveJunctionId] = useState(null);

  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: config.googleMapsApiKey || "",
  });

  useEffect(() => {
    (async () => {
      const res = await fetch(`${config.serverUrl}/api/junctions`);
      const data = await res.json();
      setJunctions(data.junctions || []);
      setActiveJunctionId(data.activeJunctionId || null);
    })();
  }, []);

  const center = useMemo(() => ({ lat: 19.076, lng: 72.8777 }), []);

  return (
    <TerminalShell
      title="Map — choose a junction"
      right={<div className="font-mono text-xs text-white/60">{activeJunctionId ? `active=${activeJunctionId}` : "offline"}</div>}
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
        <div className="overflow-hidden border border-white/10 bg-white/5">
          {!config.googleMapsApiKey ? (
            <div className="p-6 text-sm text-white/70">
              Missing <span className="font-mono text-amber-300">VITE_GOOGLE_MAPS_API_KEY</span>. Copy{" "}
              <span className="font-mono">client/.env.example</span> → <span className="font-mono">client/.env</span> and set it.
            </div>
          ) : loadError ? (
            <div className="p-6 text-sm text-red-300">Google Maps failed to load.</div>
          ) : !isLoaded ? (
            <div className="p-6 text-sm text-white/60">Loading map…</div>
          ) : (
            <GoogleMap mapContainerStyle={{ width: "100%", height: "70vh" }} center={center} zoom={12} options={{ mapTypeControl: false, streetViewControl: false }}>
              {junctions.map((j) => (
                <MarkerF
                  key={j.id}
                  position={{ lat: j.lat, lng: j.lng }}
                  title={`${j.name} (${j.multiplier_tier}x tier)`}
                  label={{
                    text: `${j.multiplier_tier}x`,
                    color: "#F5A623",
                    fontFamily: "monospace",
                    fontSize: "12px",
                    fontWeight: "700",
                  }}
                />
              ))}
            </GoogleMap>
          )}
        </div>

        <div className="border border-white/10 bg-white/5 p-4">
          <div className="font-mono text-xs text-white/60">JUNCTIONS</div>
          <div className="mt-3 space-y-3">
            {junctions.map((j) => (
              <div key={j.id} className="border border-white/10 bg-black/40 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm">{j.name}</div>
                    <div className="mt-1 text-xs text-white/60">{j.description}</div>
                  </div>
                  <div className="shrink-0 text-right font-mono text-xs">
                    <div className="text-amber-300">{j.multiplier_tier}x</div>
                    <div className="text-white/40">{j.road_count} roads</div>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <div className="font-mono text-[11px] text-white/40">{j.id}</div>
                  <Link className="font-mono text-xs text-amber-300 hover:text-amber-200" to={`/market/${j.id}`}>
                    open →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </TerminalShell>
  );
}

