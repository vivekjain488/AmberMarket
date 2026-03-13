import { ConnectButton } from "@rainbow-me/rainbowkit";

export function TerminalShell({ title, children, right }) {
  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-7xl px-4 py-4">
        <div className="flex items-center justify-between gap-4 border border-white/10 bg-white/5 px-4 py-3">
          <div className="flex items-baseline gap-3">
            <div className="font-mono text-sm text-amber-300">AmberMarket</div>
            <div className="text-sm text-white/70">{title}</div>
          </div>
          <div className="flex items-center gap-3">
            {right}
            <ConnectButton />
          </div>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

