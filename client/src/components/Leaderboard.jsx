import { useEffect, useState } from "react";
import { Trophy, Medal, Star, ShieldAlert } from "lucide-react";
import { config } from "@/lib/config";
import { useAccount } from "wagmi";

export function Leaderboard() {
  const [leaders, setLeaders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [ensByAddress, setEnsByAddress] = useState({});
  const { address: currentUser } = useAccount();

  useEffect(() => {
    async function fetchLeaders() {
      try {
        const res = await fetch(`${config.serverUrl}/api/leaderboard`);
        const data = await res.json();
        setLeaders(data.leaderboard || []);
      } catch (err) {
        console.error("Failed to fetch leaderboard", err);
      } finally {
        setLoading(false);
      }
    }
    fetchLeaders();
    const t = setInterval(fetchLeaders, 15000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!leaders.length) return;
    let cancelled = false;

    async function resolveEnsBatch() {
      const unresolved = leaders
        .map((p) => p.address?.toLowerCase())
        .filter((addr) => addr && !ensByAddress[addr]);

      if (!unresolved.length) return;

      const entries = await Promise.all(
        unresolved.map(async (addr) => {
          try {
            const res = await fetch(`${config.serverUrl}/api/ens/lookup/${addr}`);
            const data = await res.json();
            return [addr, data?.name || null];
          } catch {
            return [addr, null];
          }
        })
      );

      if (!cancelled) {
        setEnsByAddress((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
      }
    }

    resolveEnsBatch();
    return () => {
      cancelled = true;
    };
  }, [leaders, ensByAddress]);

  if (loading) {
    return (
      <div className="glass rounded-xl p-8 flex flex-col items-center justify-center animate-pulse">
        <Trophy className="h-8 w-8 text-muted-foreground/30 mb-2" />
        <div className="text-sm font-medium text-muted-foreground">Loading Elite Rankings...</div>
      </div>
    );
  }

  if (leaders.length === 0) {
    return (
      <div className="glass rounded-xl p-8 flex flex-col items-center justify-center text-center space-y-2">
        <ShieldAlert className="h-8 w-8 text-primary/40 mx-auto" />
        <h3 className="font-semibold text-lg">No Rankings Yet</h3>
        <p className="text-sm text-muted-foreground">Be the first to place a bet and climb the leaderboard.</p>
      </div>
    );
  }

  return (
    <div className="glass rounded-xl overflow-hidden mt-8 max-w-4xl mx-auto w-full">
      <div className="p-4 border-b border-border/40 bg-secondary/20 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Trophy className="h-5 w-5 text-amber-400" />
          <h2 className="font-bold text-lg text-foreground tracking-tight">Top Predictors</h2>
        </div>
        <div className="px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-[10px] font-bold text-primary uppercase tracking-wider">
          Global ELO Rankings
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left whitespace-nowrap">
          <thead className="bg-secondary/40 text-muted-foreground text-[10px] uppercase font-semibold">
            <tr>
              <th className="px-4 py-3 w-16 text-center">Rank</th>
              <th className="px-4 py-3">Player</th>
              <th className="px-4 py-3">ELO Rating</th>
              <th className="px-4 py-3">Wins</th>
              <th className="px-4 py-3">Streak</th>
              <th className="px-4 py-3">Profit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/30">
            {leaders.map((p, i) => {
              const isTop3 = i < 3;
              const normalizedAddress = p.address?.toLowerCase() || "";
              const isCurrentUser = Boolean(currentUser && normalizedAddress === currentUser.toLowerCase());
              const displayName = ensByAddress[normalizedAddress] || `${p.address.slice(0, 6)}...${p.address.slice(-4)}`;
              const totalProfit = Number(p.totalProfit || 0);
              
              return (
                <tr key={p.address} className={`hover:bg-primary/5 transition-colors group ${isCurrentUser ? 'bg-amber-500/10 border-l-2 border-amber-400' : ''}`}>
                  <td className="px-4 py-3 text-center">
                    {i === 0 ? <Medal className="h-5 w-5 text-amber-400 mx-auto" /> :
                     i === 1 ? <Medal className="h-5 w-5 text-zinc-300 mx-auto" /> :
                     i === 2 ? <Medal className="h-5 w-5 text-amber-700 mx-auto" /> :
                     <span className="text-muted-foreground font-mono font-medium">{i + 1}</span>}
                  </td>
                  <td className="px-4 py-3 font-mono">
                    <div className="flex items-center gap-2">
                      <span className={`font-semibold ${isTop3 ? 'text-foreground' : 'text-foreground/80'}`}>
                        {displayName}
                      </span>
                      {ensByAddress[normalizedAddress] && (
                        <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded">.eth</span>
                      )}
                      {isCurrentUser && (
                        <span className="text-[10px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded">YOU</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-emerald-400 font-bold font-mono">
                    {Math.round(Number(p.eloRating || 1500))}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    <span className="font-mono text-foreground">{Number(p.wins || 0)}</span>
                    <span className="text-[10px] opacity-60 ml-1">({Number(p.losses || 0)}L)</span>
                  </td>
                  <td className="px-4 py-3">
                    {Number(p.streak || 0) > 2 ? (
                      <div className="flex items-center gap-1 text-amber-500 font-bold text-xs bg-amber-500/10 px-2 py-0.5 rounded-full w-fit">
                        <Star className="h-3 w-3 fill-amber-500" /> {Number(p.streak || 0)} Win Streak
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-xs">{Number(p.streak || 0) > 0 ? Number(p.streak || 0) : '-'}</span>
                    )}
                  </td>
                  <td className={`px-4 py-3 font-mono text-xs ${totalProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {totalProfit >= 0 ? '+' : ''}{totalProfit.toFixed(2)} Ⓐ
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
