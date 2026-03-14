import { useMemo } from "react";

export function CountdownRing({ timeLeftMs, totalMs, size = 100, strokeWidth = 4 }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = totalMs > 0 ? Math.max(0, Math.min(1, timeLeftMs / totalMs)) : 0;
  const offset = circumference * (1 - progress);
  const seconds = Math.ceil(timeLeftMs / 1000);

  const color = useMemo(() => {
    if (progress > 0.5) return "stroke-emerald-400";
    if (progress > 0.2) return "stroke-amber-400";
    return "stroke-red-400";
  }, [progress]);

  const textColor = useMemo(() => {
    if (progress > 0.5) return "text-emerald-400";
    if (progress > 0.2) return "text-amber-400";
    return "text-red-400";
  }, [progress]);

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg
        className="transform -rotate-90"
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
      >
        {/* Background ring */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="hsla(225, 12%, 20%, 0.5)"
          strokeWidth={strokeWidth}
        />
        {/* Progress ring */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          className={`${color} transition-all duration-300 ease-linear`}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{
            filter: progress < 0.2 ? 'drop-shadow(0 0 6px hsla(0, 72%, 55%, 0.5))' : 'drop-shadow(0 0 4px hsla(38, 100%, 55%, 0.3))',
          }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`font-mono text-2xl font-bold ${textColor} transition-colors duration-300`}>
          {seconds}
        </span>
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">sec</span>
      </div>
    </div>
  );
}
