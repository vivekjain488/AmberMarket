import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { GoogleMap, MarkerF, useJsApiLoader } from "@react-google-maps/api";
import {
  ArrowRight, MapPin, Signal, Zap, TrendingUp,
  Radio, ChevronRight, Eye, Clock, Car
} from "lucide-react";

import { TerminalShell } from "@/components/TerminalShell";
import { StatusBadge } from "@/components/StatusBadge";
import { useSocket } from "@/hooks/useSocket";
import { config } from "@/lib/config";

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

/* ═══════════════════════════════════════════════
   J U N C T I O N   C A R D
   ═══════════════════════════════════════════════ */

function JunctionCard({ junction, isActive, livePhase, timeLeftSec }) {
  return (
    <Link
      to={`/market/${junction.id}`}
      className="group block glass rounded-xl overflow-hidden transition-all duration-300 hover:border-primary/30 hover:shadow-lg hover:shadow-amber-500/5 glass-hover"
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
          <div className="absolute bottom-2 right-2 flex items-center gap-1.5 px-2 py-1 rounded-lg bg-black/60 backdrop-blur-sm border border-border/30">
            <Clock className="h-3 w-3 text-primary" />
            <span className="text-[10px] font-mono font-bold text-primary">
              {livePhase === "RED_OPEN" ? "Betting" : livePhase === "GREEN_COUNTING" ? "Counting" : "Settling"}
            </span>
            {timeLeftSec != null && (
              <span className="text-[10px] font-mono text-foreground">{timeLeftSec}s</span>
            )}
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
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Signal className="h-3 w-3" />
              <span className="font-mono">{junction.road_count} roads</span>
            </div>
          </div>
          <div className="flex items-center gap-1 text-xs font-medium text-primary opacity-0 group-hover:opacity-100 transition-opacity duration-300">
            Trade <ChevronRight className="h-3 w-3" />
          </div>
        </div>
      </div>
    </Link>
  );
}

/* ═══════════════════════════════════════════════
   H O M E   P A G E
   ═══════════════════════════════════════════════ */

export function Home() {
  const [junctions, setJunctions] = useState([]);
  const [activeJunctionId, setActiveJunctionId] = useState(null);
  const refreshRef = useRef(null);

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

  // When socket tells us the phase changed, re-fetch to stay in sync
  useEffect(() => {
    if (marketState?.engineState) {
      fetchJunctions();
    }
  }, [marketState?.engineState, fetchJunctions]);

  // Derive live phase info from socket for the active junction card
  const livePhase = marketState?.engineState || null;
  const liveTimeLeftSec = useMemo(() => {
    if (!marketState?.stateSinceMs || !marketState?.countdown) return null;
    const { engineState, stateSinceMs, countdown } = marketState;
    let durationMs = 0;
    if (engineState === "RED_OPEN") durationMs = countdown.redMs;
    else if (engineState === "GREEN_COUNTING") durationMs = countdown.greenMs;
    else if (engineState === "SETTLING") durationMs = countdown.settleMs || 3000;
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
              Stake USDC, watch the live CCTV feed, and win from the pool.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="px-4 py-2 rounded-xl glass text-xs font-medium text-primary flex items-center gap-2">
              <Zap className="h-3.5 w-3.5" />
              Powered by Base Sepolia
            </div>
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
                <MarkerF
                  key={j.id}
                  position={{ lat: j.lat, lng: j.lng }}
                  title={`${j.name} (${j.multiplier_tier}x tier)`}
                  label={{
                    text: `${j.multiplier_tier}x`,
                    color: "#f59e0b",
                    fontFamily: "JetBrains Mono, monospace",
                    fontSize: "11px",
                    fontWeight: "700",
                  }}
                />
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
    </TerminalShell>
  );
}
