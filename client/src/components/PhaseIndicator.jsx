import { Timer, Eye, Landmark, Pause } from "lucide-react";

const phases = [
  { key: "RED_OPEN", label: "Betting Open", icon: Timer, colorClass: "phase-red", bgClass: "bg-phase-red" },
  { key: "GREEN_COUNTING", label: "Counting", icon: Eye, colorClass: "phase-green", bgClass: "bg-phase-green" },
  { key: "SETTLING", label: "Settling", icon: Landmark, colorClass: "phase-amber", bgClass: "bg-phase-amber" },
];

export function PhaseIndicator({ currentPhase }) {
  return (
    <div className="flex items-center gap-1 w-full">
      {phases.map((p, i) => {
        const isActive = p.key === currentPhase;
        const isPast = phases.findIndex(x => x.key === currentPhase) > i;
        const Icon = p.icon;

        return (
          <div key={p.key} className="flex items-center flex-1">
            <div
              className={`
                flex items-center gap-2 px-3 py-2 rounded-lg border transition-all duration-500 w-full
                ${isActive
                  ? `${p.bgClass} border-current ${p.colorClass} shadow-lg`
                  : isPast
                    ? 'bg-secondary/50 border-border text-muted-foreground'
                    : 'bg-secondary/20 border-border/50 text-muted-foreground/50'
                }
              `}
            >
              <Icon className={`h-3.5 w-3.5 shrink-0 ${isActive ? 'animate-pulse' : ''}`} />
              <span className="text-xs font-medium truncate">{p.label}</span>
              {isActive && (
                <div className="ml-auto h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
              )}
            </div>
            {i < phases.length - 1 && (
              <div className={`h-px w-3 shrink-0 mx-0.5 ${isPast ? 'bg-muted-foreground' : 'bg-border/50'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}
