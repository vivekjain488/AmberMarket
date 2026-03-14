import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Link, useLocation } from "react-router-dom";
import { Activity, Home, BarChart3 } from "lucide-react";
import { useState, useEffect } from "react";
import { useAccount, useReadContract } from "wagmi";
import { formatUnits } from "viem";
import { config } from "@/lib/config";
import { erc20Abi } from "@/lib/amberMarketAbi";
import { useGameMode } from "@/contexts/GameModeContext";

const navLinks = [
  { to: "/", label: "Home", icon: Home },
];

export function TerminalShell({ title, children, right }) {
  const location = useLocation();
  const { address, isConnected } = useAccount();
  const [myEns, setMyEns] = useState(null);
  
  useEffect(() => {
    if (!isConnected || !address) {
      setMyEns(null);
      return;
    }
    fetch(`${config.serverUrl}/api/ens/lookup/${address}`)
      .then(r => r.json())
      .then(d => {
        if (d.name) setMyEns(d.name);
      })
      .catch(console.error);
  }, [isConnected, address]);

  // Fetch AMBER balance
  const { data: amberBalance } = useReadContract({
    address: config.amberTokenAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address],
    query: {
      enabled: isConnected && !!address && !!config.amberTokenAddress,
      refetchInterval: 10000,
    }
  });

  const formattedBalance = amberBalance != null ? Number(formatUnits(amberBalance, 18)).toFixed(0) : "0";
  const { isPracticeMode, setIsPracticeMode, practiceBalance, practiceNotifications } = useGameMode();

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ── Ambient background gradient ── */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-amber-500/[0.03] rounded-full blur-[120px]" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-emerald-500/[0.02] rounded-full blur-[120px]" />
      </div>

      {/* ── Top Navigation Bar ── */}
      <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex h-16 items-center justify-between gap-4">
            {/* Left: Brand + Nav */}
            <div className="flex items-center gap-6">
              <Link to="/" className="flex items-center gap-2.5 group">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500 to-amber-600 shadow-lg shadow-amber-500/20 group-hover:shadow-amber-500/30 transition-shadow">
                  <Activity className="h-4 w-4 text-white" />
                </div>
                <span className="text-lg font-bold tracking-tight">
                  <span className="text-gradient-amber">Amber</span>
                  <span className="text-foreground">Market</span>
                </span>
              </Link>

              <nav className="hidden sm:flex items-center gap-1">
                {navLinks.map((link) => {
                  const Icon = link.icon;
                  const isActive = location.pathname === link.to;
                  return (
                    <Link
                      key={link.to}
                      to={link.to}
                      className={`
                        flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200
                        ${isActive
                          ? 'bg-primary/10 text-primary'
                          : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                        }
                      `}
                    >
                      <Icon className="h-4 w-4" />
                      {link.label}
                    </Link>
                  );
                })}
                {title && (
                  <>
                    <div className="mx-2 h-4 w-px bg-border" />
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary/30 text-sm">
                      <BarChart3 className="h-4 w-4 text-primary" />
                      <span className="text-foreground font-medium">{title}</span>
                    </div>
                  </>
                )}
              </nav>
            </div>

            {/* Right: Status + Wallet */}
            <div className="flex items-center gap-3">
              {/* Practice Toggle */}
              <div className="hidden sm:flex items-center gap-2 mr-2">
                <span className={`text-[10px] font-bold uppercase tracking-widest ${!isPracticeMode ? 'text-primary' : 'text-muted-foreground'}`}>
                  Arena
                </span>
                <button
                  type="button"
                  onClick={() => setIsPracticeMode(!isPracticeMode)}
                  className={`
                    relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent 
                    transition-colors duration-200 ease-in-out focus:outline-none 
                    ${isPracticeMode ? "bg-amber-500" : "bg-primary"}
                  `}
                >
                  <span
                    className={`
                      pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 
                      transition duration-200 ease-in-out
                      ${isPracticeMode ? "translate-x-4" : "translate-x-0"}
                    `}
                  />
                </button>
                <span className={`text-[10px] font-bold uppercase tracking-widest ${isPracticeMode ? 'text-amber-500' : 'text-muted-foreground'}`}>
                  Practice
                </span>
              </div>
              
              {right}
              <ConnectButton.Custom>
                {({ account, chain, openAccountModal, openChainModal, openConnectModal, authenticationStatus, mounted }) => {
                  const ready = mounted && authenticationStatus !== 'loading';
                  const connected = ready && account && chain && (!authenticationStatus || authenticationStatus === 'authenticated');

                  if (!ready) {
                    return (
                      <div aria-hidden="true" style={{ opacity: 0, pointerEvents: 'none', userSelect: 'none' }}>
                        <button disabled>Loading...</button>
                      </div>
                    );
                  }

                  if (!connected) {
                    return (
                      <button onClick={openConnectModal} type="button" className="bg-primary/20 text-primary border border-primary/30 px-3 py-1.5 rounded-lg text-sm font-bold shadow shadow-primary/10 hover:bg-primary/30 transition-all font-mono">
                        Connect Wallet
                      </button>
                    );
                  }

                  if (chain.unsupported) {
                    return (
                      <button onClick={openChainModal} type="button" className="bg-red-500/20 text-red-500 border border-red-500/30 px-3 py-1.5 rounded-lg text-sm font-bold shadow shadow-red-500/10 hover:bg-red-500/30 transition-all font-mono">
                        Wrong Network
                      </button>
                    );
                  }

                  return (
                    <div className="flex gap-2">
                      <button
                        onClick={openChainModal}
                        type="button"
                        className="hidden sm:flex items-center text-xs font-mono font-bold bg-secondary/80 border border-border px-3 py-1.5 rounded-lg text-foreground hover:bg-secondary transition-colors"
                      >
                        {chain.hasIcon && (
                          <div style={{ background: chain.iconBackground }} className="w-4 h-4 rounded-full overflow-hidden mr-2">
                            {chain.iconUrl && (<img alt={chain.name ?? 'Chain icon'} src={chain.iconUrl} className="w-4 h-4" />)}
                          </div>
                        )}
                        {chain.name}
                      </button>

                      {isPracticeMode ? (
                        <div className="flex items-center text-xs font-mono font-bold bg-amber-500/20 border border-amber-500/40 text-amber-500 px-3 py-1.5 rounded-lg relative overflow-hidden group" title="Practice AMBER (P-AMBER)">
                          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
                          {Number(practiceBalance).toFixed(0)} P-Ⓐ
                        </div>
                      ) : (
                        <div className="flex items-center text-xs font-mono font-bold bg-primary/10 border border-primary/30 text-primary px-3 py-1.5 rounded-lg">
                          {formattedBalance} Ⓐ
                        </div>
                      )}

                      <button onClick={openAccountModal} type="button" className="flex items-center text-xs font-mono font-bold bg-primary/20 text-primary border border-primary/30 px-3 py-1.5 rounded-lg shadow shadow-primary/10 hover:bg-primary/30 transition-all">
                        {myEns || account.displayName}
                      </button>
                    </div>
                  );
                }}
              </ConnectButton.Custom>
            </div>
          </div>
        </div>
      </header>

      {/* ── Main Content ── */}
      <main className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 py-6">
        {children}
      </main>

      {/* ── Practice Notifications ── */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
        {practiceNotifications.map((note) => (
          <div key={note.id} className="bg-amber-950/90 border border-amber-500/50 text-amber-100 px-4 py-3 rounded-xl shadow-xl shadow-amber-900/20 backdrop-blur-md max-w-sm animate-in slide-in-from-bottom-2 fade-in duration-300">
            {note.message}
          </div>
        ))}
      </div>

      {/* ── Footer ── */}
      <footer className="relative z-10 border-t border-border/40 mt-12">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6 flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            © 2026 AmberMarket · Built on <span className="text-primary font-medium">Base Sepolia</span>
          </div>
          <div className="text-xs text-muted-foreground/60 font-mono">
            v0.1.0-hackathon
          </div>
        </div>
      </footer>
    </div>
  );
}
