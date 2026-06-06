import { cn } from "@/lib/utils";

// Brand FrameG mark with the animated "AI" glyph — the G traces, the tongue +
// "AI" fade in, looping (holds finished under reduced-motion). Sizes itself via
// the `.aig-mark` rule; reused by the full-screen loader and the nav overlay.
export function AigMark({ className }: { className?: string }) {
  return (
    <svg className={cn("aig-mark", className)} viewBox="0 0 100 100" aria-hidden="true">
      <path
        className="g"
        d="M 86 32 L 86 14 L 14 14 L 14 86 L 86 86 L 86 68"
        pathLength={100}
        stroke="#22c55e"
        strokeWidth={12}
        fill="none"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <rect className="tongue" x={58} y={44} width={28} height={12} rx={2} fill="#22c55e" />
      <text
        className="ai"
        x={40}
        y={51}
        fontFamily="'Space Grotesk', Inter, system-ui, sans-serif"
        fontWeight={700}
        fontSize={32}
        textAnchor="middle"
        dominantBaseline="central"
        letterSpacing={-2.5}
        fill="#ffffff"
      >
        AI
      </text>
    </svg>
  );
}

// Brand full-screen loader for cold boot / full-surface waits. On-dark veil.
// Pure SVG + CSS — safe in a server `loading.tsx`.
export function AigLoader() {
  return (
    <div className="aig-loader" role="status" aria-label="Loading AIGarage">
      <AigMark />
    </div>
  );
}
