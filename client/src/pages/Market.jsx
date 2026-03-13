import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import Hls from "hls.js";

import { TerminalShell } from "@/components/TerminalShell";
import { useSocket } from "@/hooks/useSocket";
import { config } from "@/lib/config";
import { amberMarketAbi } from "@/lib/amberMarketAbi";

import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { parseUnits } from "viem";

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

  if (error) return <div className={className + " flex items-center justify-center p-6 text-sm text-amber-300"}>{error}</div>;
  return (
    <video ref={videoRef} className={className} muted autoPlay playsInline controls />
  );
}

export function Market() {
  const { junctionId } = useParams();
  const { connected, hello, counting, settled } = useSocket();
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const [junction, setJunction] = useState(null);
  const [marketState, setMarketState] = useState(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [rangeMin, setRangeMin] = useState(12);
  const [rangeMax, setRangeMax] = useState(16);
  const [stake, setStake] = useState("1");
  const [txStatus, setTxStatus] = useState(null);

  useEffect(() => {
    (async () => {
      const res = await fetch(`${config.serverUrl}/api/junctions`);
      const data = await res.json();
      const j = (data.junctions || []).find((x) => x.id === junctionId);
      setJunction(j || null);
      setMarketState(null);
    })();
  }, [junctionId]);

  useEffect(() => {
    (async () => {
      const res = await fetch(`${config.serverUrl}/api/market/${junctionId}`);
      const data = await res.json();
      setMarketState(data);
    })();
  }, [junctionId]);

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  const phase = marketState?.engineState || "UNKNOWN";
  const stateSinceMs = marketState?.stateSinceMs || nowMs;
  const countdown = marketState?.countdown || { redMs: 30000, greenMs: 20000 };

  const timeLeftLabel = useMemo(() => {
    const ms =
      phase === "RED_OPEN"
        ? msLeft(stateSinceMs, countdown.redMs)
        : phase === "GREEN_COUNTING"
          ? msLeft(stateSinceMs, countdown.greenMs)
          : 0;
    return `${Math.ceil(ms / 1000)}s`;
  }, [phase, stateSinceMs, countdown.redMs, countdown.greenMs, nowMs]);

  async function placeBet() {
    setTxStatus(null);
    if (!walletClient || !address) return setTxStatus("Connect wallet first.");
    if (!config.contractAddress) return setTxStatus("Missing VITE_CONTRACT_ADDRESS.");

    try {
      const stakeAmount = parseUnits(stake || "0", 6);
      const hash = await walletClient.writeContract({
        address: config.contractAddress,
        abi: amberMarketAbi,
        functionName: "placeBet",
        args: [Number(rangeMin), Number(rangeMax), stakeAmount],
      });
      setTxStatus(`Bet tx sent: ${hash}`);
      await publicClient.waitForTransactionReceipt({ hash });
      setTxStatus("Bet confirmed.");
    } catch (e) {
      setTxStatus(e?.shortMessage || e?.message || "Bet failed");
    }
  }

  async function claim() {
    setTxStatus(null);
    if (!walletClient || !address) return setTxStatus("Connect wallet first.");
    if (!config.contractAddress) return setTxStatus("Missing VITE_CONTRACT_ADDRESS.");
    try {
      const hash = await walletClient.writeContract({
        address: config.contractAddress,
        abi: amberMarketAbi,
        functionName: "claimWinnings",
        args: [],
      });
      setTxStatus(`Claim tx sent: ${hash}`);
      await publicClient.waitForTransactionReceipt({ hash });
      setTxStatus("Claim confirmed.");
    } catch (e) {
      setTxStatus(e?.shortMessage || e?.message || "Claim failed");
    }
  }

  return (
    <TerminalShell
      title={`Market — ${junctionId}`}
      right={
        <div className="flex items-center gap-3 font-mono text-xs text-white/60">
          <div>{connected ? "ws=up" : "ws=down"}</div>
          <div>{hello?.chain?.onchainEnabled ? "oracle=onchain" : "oracle=sim"}</div>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[420px_1fr]">
        <div className="border border-white/10 bg-white/5 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm">{junction?.name || "Unknown junction"}</div>
              <div className="mt-1 text-xs text-white/60">{junction?.description}</div>
            </div>
            <div className="text-right font-mono text-xs">
              <div className="text-amber-300">{junction?.multiplier_tier || "—"}x</div>
              <div className="text-white/40">{junction?.road_count || "—"} roads</div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="border border-white/10 bg-black/40 p-3">
              <div className="font-mono text-[11px] text-white/40">PHASE</div>
              <div className="mt-1 font-mono text-sm text-white">{phase}</div>
            </div>
            <div className="border border-white/10 bg-black/40 p-3">
              <div className="font-mono text-[11px] text-white/40">TIME LEFT</div>
              <div className="mt-1 font-mono text-sm text-amber-300">{timeLeftLabel}</div>
            </div>
          </div>

          <div className="mt-4 border border-white/10 bg-black/40 p-3">
            <div className="font-mono text-[11px] text-white/40">BET</div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <input
                className="w-full bg-black/60 px-2 py-2 font-mono text-sm text-white outline-none ring-1 ring-white/10 focus:ring-amber-300/60"
                type="number"
                value={rangeMin}
                onChange={(e) => setRangeMin(e.target.value)}
                min={0}
                max={150}
              />
              <input
                className="w-full bg-black/60 px-2 py-2 font-mono text-sm text-white outline-none ring-1 ring-white/10 focus:ring-amber-300/60"
                type="number"
                value={rangeMax}
                onChange={(e) => setRangeMax(e.target.value)}
                min={0}
                max={150}
              />
              <input
                className="w-full bg-black/60 px-2 py-2 font-mono text-sm text-white outline-none ring-1 ring-white/10 focus:ring-amber-300/60"
                type="number"
                step="0.1"
                value={stake}
                onChange={(e) => setStake(e.target.value)}
              />
            </div>
            <div className="mt-2 flex items-center justify-between gap-3 text-xs text-white/50">
              <div className="font-mono">rangeMin / rangeMax / stake(USDC)</div>
              <button
                className="border border-amber-300/40 bg-amber-300/10 px-3 py-2 font-mono text-xs text-amber-200 hover:bg-amber-300/15 disabled:opacity-50"
                onClick={placeBet}
                disabled={phase !== "RED_OPEN"}
              >
                placeBet()
              </button>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between gap-3">
            <button className="border border-white/10 bg-white/5 px-3 py-2 font-mono text-xs text-white/80 hover:bg-white/10" onClick={claim} disabled={phase !== "SETTLING" && phase !== "RED_OPEN"}>
              claimWinnings()
            </button>
            <div className="text-right font-mono text-[11px] text-white/50">{txStatus}</div>
          </div>

          <div className="mt-4 border border-white/10 bg-black/40 p-3">
            <div className="font-mono text-[11px] text-white/40">LIVE COUNT</div>
            <div className="mt-1 font-mono text-sm text-white">{counting?.currentCount ?? marketState?.python?.currentCount ?? 0}</div>
            <div className="mt-1 font-mono text-[11px] text-white/40">frames {counting?.frameNumber ?? marketState?.python?.frames ?? 0}</div>
          </div>

          <div className="mt-4 border border-white/10 bg-black/40 p-3">
            <div className="font-mono text-[11px] text-white/40">LAST SETTLEMENT</div>
            <div className="mt-1 font-mono text-sm text-amber-300">{settled?.finalCount ?? marketState?.lastSettlement?.finalCount ?? "—"}</div>
            <div className="mt-1 text-xs text-white/60">
              range [{settled?.toleranceLow ?? marketState?.lastSettlement?.toleranceLow ?? "—"}, {settled?.toleranceHigh ?? marketState?.lastSettlement?.toleranceHigh ?? "—"}]
            </div>
          </div>
        </div>

        <div className="border border-white/10 bg-white/5 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="font-mono text-xs text-white/60">CCTV FEED</div>
            {junction?.vmPageUrl && (
              <a
                href={junction.vmPageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[11px] text-amber-300 hover:text-amber-200"
              >
                View on Caltrans VM →
              </a>
            )}
          </div>
          <div className="mt-3 overflow-hidden border border-white/10 bg-black/50">
            {junction?.stream_url && toYouTubeEmbedUrl(junction.stream_url) ? (
              <iframe
                title="cctv"
                className="h-[70vh] w-full"
                src={toYouTubeEmbedUrl(junction.stream_url)}
                allow="autoplay; encrypted-media"
              />
            ) : junction?.stream_url && isHlsUrl(junction.stream_url) ? (
              <HlsVideoPlayer src={junction.stream_url} className="h-[70vh] w-full object-contain bg-black" />
            ) : junction?.stream_url ? (
              <div className="p-6 text-sm text-white/60">Unsupported stream format. Use &quot;View on Caltrans VM&quot; for live video.</div>
            ) : (
              <div className="p-6 text-sm text-white/60">No stream URL configured.</div>
            )}
          </div>

          {(junction?.currentImageURL || (junction?.referenceImageUrls?.length > 0)) && (
            <div className="mt-4">
              <div className="font-mono text-xs text-white/60">FOOTAGE — current &amp; previous snapshots</div>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                {junction.currentImageURL && (
                  <div className="border border-white/10 bg-black/40 p-1">
                    <div className="font-mono text-[10px] text-amber-300/80">LIVE</div>
                    <img src={junction.currentImageURL + "?t=" + Math.floor(Date.now() / 15000)} alt="Current" className="mt-1 w-full object-contain" />
                  </div>
                )}
                {(junction.referenceImageUrls || []).slice(0, 11).map((url, i) => (
                  <div key={url} className="border border-white/10 bg-black/40 p-1">
                    <div className="font-mono text-[10px] text-white/40">−{i + 1}</div>
                    <img src={url} alt={`Previous ${i + 1}`} className="mt-1 w-full object-contain" />
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

