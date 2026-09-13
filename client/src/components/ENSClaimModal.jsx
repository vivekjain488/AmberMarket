import { useState, useEffect, useRef } from "react";
import { useAccount } from "wagmi";
import { config } from "@/lib/config";
import { Loader2, Fingerprint, Check, X, ExternalLink } from "lucide-react";

export function ENSClaimModal({ onClose, onSuccess }) {
  const parentName = "ambermarket.eth";
  const labelPattern = /^[a-z0-9-]{3,63}$/;
  const { address, isConnected } = useAccount();
  const [label, setLabel] = useState("");
  const [status, setStatus] = useState("idle"); // idle | checking | available | taken | claiming | success | error
  const [errorMsg, setErrorMsg] = useState("");
  const debounceRef = useRef(null);

  const normalizedLabel = label.toLowerCase().trim();

  function validateInputLabel(value) {
    if (!value || value.length < 3) return "Username must be at least 3 characters";
    if (!labelPattern.test(value)) return "Use only lowercase letters, numbers, and hyphens (3-63 chars)";
    if (value.startsWith("-") || value.endsWith("-")) return "Username cannot start or end with a hyphen";
    return null;
  }

  // Debounced availability check as user types
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const val = normalizedLabel;
    if (!val || val.length < 3 || validateInputLabel(val)) {
      setStatus("idle");
      return;
    }

    setStatus("checking");
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `${config.serverUrl}/api/ens/check-availability?label=${encodeURIComponent(val)}`
        );
        const data = await res.json();
        if (!res.ok) {
          // Server has no API key configured — skip availability check silently
          setStatus("idle");
          return;
        }
        setStatus(data.available ? "available" : "taken");
      } catch {
        setStatus("idle"); // Network error, don't block the user
      }
    }, 400);

    return () => clearTimeout(debounceRef.current);
  }, [normalizedLabel]);

  const handleClaim = async () => {
    if (!isConnected || !address) {
      setErrorMsg("Please connect wallet first");
      return;
    }
    const labelError = validateInputLabel(normalizedLabel);
    if (labelError) {
      setErrorMsg(labelError);
      return;
    }

    setStatus("claiming");
    setErrorMsg("");
    try {
      const res = await fetch(`${config.serverUrl}/api/ens/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: normalizedLabel, address }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to claim");
      }

      setStatus("success");
      if (typeof window !== "undefined") {
        localStorage.setItem("amber_lastEnsLabel", normalizedLabel);
      }
      setTimeout(() => {
        if (onSuccess) onSuccess(data.name);
        onClose();
      }, 2500);
    } catch (e) {
      console.error(e);
      setStatus("error");
      setErrorMsg(e.message);
    }
  };

  const fullName = normalizedLabel ? `${normalizedLabel}.${parentName}` : "";

  // Availability indicator
  const renderAvailabilityIndicator = () => {
    if (!normalizedLabel || normalizedLabel.length < 3) return null;
    const err = validateInputLabel(normalizedLabel);
    if (err) return null;

    switch (status) {
      case "checking":
        return (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-2 font-mono">
            <Loader2 className="h-3 w-3 animate-spin" />
            Checking availability…
          </div>
        );
      case "available":
        return (
          <div className="flex items-center gap-1.5 text-xs text-emerald-400 mt-2 font-mono">
            <Check className="h-3 w-3" />
            {fullName} is available!
          </div>
        );
      case "taken":
        return (
          <div className="flex items-center gap-1.5 text-xs text-red-400 mt-2 font-mono">
            <X className="h-3 w-3" />
            {fullName} is already taken
          </div>
        );
      default:
        return null;
    }
  };

  const canClaim =
    normalizedLabel.length >= 3 &&
    !validateInputLabel(normalizedLabel) &&
    status !== "claiming" &&
    status !== "success" &&
    status !== "taken";

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
          
          <h2 className="text-xl font-bold font-mono tracking-tight text-foreground">Claim Your ENS Identity</h2>
          <p className="text-sm text-muted-foreground mt-2 mb-6">
            Register your free <strong className="text-primary">.ambermarket.eth</strong> Web3 identity — powered by ENS.
          </p>

          {/* Input field */}
          <div className="relative mb-1">
            <input
              type="text"
              value={label}
              onChange={(e) => { setLabel(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "")); setErrorMsg(""); }}
              placeholder="username"
              maxLength={63}
              className="w-full bg-background/50 border border-border/50 rounded-lg py-3 pl-4 pr-[140px] font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 text-sm"
              disabled={status === "claiming" || status === "success"}
              autoFocus
            />
            <span className="absolute right-3 top-3 text-muted-foreground/60 font-mono text-sm select-none">
              .ambermarket.eth
            </span>
          </div>

          {/* Availability indicator */}
          {renderAvailabilityIndicator()}

          {/* Validation error */}
          {normalizedLabel.length > 0 && normalizedLabel.length < 3 && (
            <div className="text-xs text-muted-foreground font-mono mt-2">
              Minimum 3 characters
            </div>
          )}

          {/* Error message */}
          {errorMsg && (
            <div className="text-xs text-red-400 font-mono mt-3 bg-red-400/10 p-2.5 rounded-lg border border-red-400/20">
              {errorMsg}
            </div>
          )}

          {/* Success state */}
          {status === "success" && (
            <div className="mt-4 py-3 px-4 bg-emerald-400/10 border border-emerald-400/20 rounded-xl animate-in fade-in duration-300">
              <div className="text-emerald-400 font-mono text-sm font-bold mb-1">
                ✅ Successfully registered!
              </div>
              <div className="text-emerald-300/80 font-mono text-xs mb-2">
                {fullName}
              </div>
              <a
                href={`https://app.ens.domains/${fullName}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
              >
                View on ENS <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-3 mt-6">
            <button
              onClick={onClose}
              disabled={status === "claiming"}
              className="flex-1 py-2.5 rounded-lg bg-background/50 hover:bg-background border border-border text-sm font-medium transition-colors"
            >
              {status === "success" ? "Close" : "Skip"}
            </button>
            {status !== "success" && (
              <button
                onClick={handleClaim}
                disabled={!canClaim}
                className="flex-1 py-2.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold transition-all flex justify-center items-center shadow-lg shadow-primary/25 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {status === "claiming" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Mint Free ENS"
                )}
              </button>
            )}
          </div>

          {/* Footer info */}
          <p className="text-[10px] text-muted-foreground/50 mt-4 font-mono">
            Offchain subname · Gas-free · Powered by Namespace
          </p>
        </div>
      </div>
    </div>
  );
}
