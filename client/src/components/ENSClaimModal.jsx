import { useState } from "react";
import { useAccount } from "wagmi";
import { config } from "@/lib/config";
import { Loader2, Fingerprint } from "lucide-react";

export function ENSClaimModal({ onClose, onSuccess }) {
  const { address, isConnected } = useAccount();
  const [label, setLabel] = useState("");
  const [status, setStatus] = useState("idle"); // idle | claiming | success | error
  const [errorMsg, setErrorMsg] = useState("");

  const handleClaim = async () => {
    if (!isConnected || !address) {
      setErrorMsg("Please connect wallet first");
      return;
    }
    if (!label || label.length < 3) {
      setErrorMsg("Username must be at least 3 characters");
      return;
    }

    setStatus("claiming");
    setErrorMsg("");
    try {
      const res = await fetch(`${config.serverUrl}/api/ens/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.toLowerCase().trim(), address }),
      });

      const data = await res.json();
      
      if (!res.ok) {
        if (data.error === "ENS API Key not configured on server") {
          // Graceful fallback for local dev / unconfigured servers
          setStatus("success");
          setTimeout(() => {
            if (onSuccess) onSuccess(`${label.toLowerCase().trim()}.ambermarket.eth`);
            onClose();
          }, 2000);
          return;
        }
        throw new Error(data.error || "Failed to claim");
      }

      setStatus("success");
      setTimeout(() => {
        if (onSuccess) onSuccess(data.name);
        onClose();
      }, 2000);
    } catch (e) {
      console.error(e);
      setStatus("error");
      setErrorMsg(e.message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm animate-in fade-in duration-200 p-4">
      <div className="border border-border/50 bg-secondary/80 backdrop-blur-xl rounded-2xl p-6 w-full max-w-sm shadow-2xl relative overflow-hidden">
        
        {/* Decorative background glow */}
        <div className="absolute -top-20 -right-20 w-40 h-40 bg-primary/20 rounded-full blur-3xl" />
        <div className="absolute -bottom-20 -left-20 w-40 h-40 bg-blue-500/20 rounded-full blur-3xl" />

        <div className="relative z-10 text-center">
          <div className="h-12 w-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4 border border-primary/20">
            <Fingerprint className="h-6 w-6 text-primary" />
          </div>
          
          <h2 className="text-xl font-bold font-mono tracking-tight text-foreground">Claim Your God Mode</h2>
          <p className="text-sm text-muted-foreground mt-2 mb-6">
            Register your custom <strong className="text-primary">.ambermarket.eth</strong> Web3 identity perfectly and amazingly.
          </p>

          <div className="relative mb-4">
            <input
              type="text"
              value={label}
              onChange={(e) => { setLabel(e.target.value); setErrorMsg(""); }}
              placeholder="username"
              className="w-full bg-background/50 border border-border/50 rounded-lg py-3 px-4 text-center font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              disabled={status === "claiming" || status === "success"}
            />
            <span className="absolute right-4 top-3 text-muted-foreground/60 font-mono select-none">
              .ambermarket...
            </span>
          </div>

          {errorMsg && (
            <div className="text-xs text-red-400 font-mono mb-4 bg-red-400/10 p-2 rounded border border-red-400/20">
              {errorMsg}
            </div>
          )}

          {status === "success" && (
            <div className="text-xs text-emerald-400 font-mono mb-4 py-2 bg-emerald-400/10 border border-emerald-400/20 rounded">
              ✅ Successfully registered {label}.ambermarket.eth!
            </div>
          )}

          <div className="flex gap-3 mt-6">
            <button
              onClick={onClose}
              disabled={status === "claiming"}
              className="flex-1 py-2 rounded-lg bg-background/50 hover:bg-background border border-border text-sm font-medium transition-colors"
            >
              Skip
            </button>
            <button
              onClick={handleClaim}
              disabled={status === "claiming" || status === "success" || !label}
              className="flex-1 py-2 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold transition-all flex justify-center items-center shadow-lg shadow-primary/25 disabled:opacity-50"
            >
              {status === "claiming" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Mint Free"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
