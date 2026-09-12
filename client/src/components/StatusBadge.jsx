import { Activity, Wifi, WifiOff } from "lucide-react";

export function StatusBadge({ connected, label }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full glass text-xs font-medium">
      <div className="relative flex items-center">
        <div
          className={`h-2 w-2 rounded-full ${
            connected ? "bg-emerald-400" : "bg-red-400"
          }`}
        />
        {connected && (
          <div className="absolute inset-0 h-2 w-2 rounded-full bg-emerald-400 animate-ping opacity-75" />
        )}
      </div>
      {connected ? (
        <Wifi className="h-3 w-3 text-emerald-400" />
      ) : (
        <WifiOff className="h-3 w-3 text-red-400" />
      )}
      <span className={connected ? "text-emerald-300" : "text-red-300"}>
        {label || (connected ? "Connected" : "Disconnected")}
      </span>
    </div>
  );
}
