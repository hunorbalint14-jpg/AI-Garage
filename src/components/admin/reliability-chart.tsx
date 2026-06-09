// Server-rendered SVG area+line chart for the reliability dashboard (ported
// from the prototype's TimeChart, minus client hover). One series, filled area.

const TONE: Record<string, string> = {
  ok: "#5fdd9d",
  warn: "#f5c451",
  bad: "#ff7b7b",
  info: "#7aa2ff",
};

export function TrendChart({
  data,
  tone = "info",
  height = 120,
  suffix = "",
}: {
  data: number[];
  tone?: "ok" | "warn" | "bad" | "info";
  height?: number;
  suffix?: string;
}) {
  const color = TONE[tone] ?? TONE.info;
  if (data.length < 2) {
    return (
      <div
        className="grid place-items-center rounded-lg border border-[#23272f] bg-[#15181d] text-xs text-[#5a6170]"
        style={{ height }}
      >
        Not enough data yet — fills in as checks run.
      </div>
    );
  }

  const W = 600;
  const padT = 8;
  const padB = 16;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const lo = min - span * 0.12;
  const hi = max + span * 0.12;
  const n = data.length;
  const x = (i: number) => (i / (n - 1)) * W;
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (height - padT - padB);

  const line = data.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L ${W} ${height - padB} L 0 ${height - padB} Z`;
  const gid = `rg-${tone}`;

  return (
    <div className="rounded-lg border border-[#23272f] bg-[#15181d] p-2">
      <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height} preserveAspectRatio="none" className="block">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.18" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((t) => (
          <line
            key={t}
            x1={0}
            x2={W}
            y1={padT + t * (height - padT - padB)}
            y2={padT + t * (height - padT - padB)}
            stroke="#23272f"
            strokeDasharray="2 4"
          />
        ))}
        <path d={area} fill={`url(#${gid})`} />
        <path d={line} fill="none" stroke={color} strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-[#5a6170]">
        <span>
          {min.toLocaleString("en-GB")}
          {suffix}
        </span>
        <span>
          {max.toLocaleString("en-GB")}
          {suffix}
        </span>
      </div>
    </div>
  );
}
