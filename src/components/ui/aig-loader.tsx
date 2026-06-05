// Brand full-screen loader (AIGarage FrameG mark) for cold boot / full-surface
// waits. On-dark colourway, fixed full-viewport. Pure SVG + CSS — safe in a
// server `loading.tsx`. Holds a finished static mark under reduced-motion.
export function AigLoader() {
  return (
    <div className="aig-loader" role="status" aria-label="Loading AIGarage">
      <svg className="aig-mark" viewBox="0 0 100 100" aria-hidden="true">
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
    </div>
  );
}
