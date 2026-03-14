import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Link, useLocation } from "react-router-dom";
import { Activity, Home, BarChart3 } from "lucide-react";

const navLinks = [
  { to: "/", label: "Home", icon: Home },
];

export function TerminalShell({ title, children, right }) {
  const location = useLocation();

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
              {right}
              <ConnectButton
                showBalance={false}
                chainStatus="icon"
                accountStatus={{
                  smallScreen: "avatar",
                  largeScreen: "full",
                }}
              />
            </div>
          </div>
        </div>
      </header>

      {/* ── Main Content ── */}
      <main className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 py-6">
        {children}
      </main>

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
