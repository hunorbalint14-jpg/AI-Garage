function Sparkline({ values, color }: { values: number[]; color: string }) {
  // A single point can't make a line (and divides by zero below).
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const w = 80;
  const h = 28;
  const range = max - min || 1;
  const pts = values
    .map((v, i) => `${(i / (values.length - 1)) * w},${h - ((v - min) / range) * h}`)
    .join(" ");
  const last = values[values.length - 1];
  const lastY = h - ((last - min) / range) * h;
  return (
    <svg width={w} height={h} className="shrink-0 overflow-visible">
      <polyline fill="none" stroke={color} strokeWidth="1.5" points={pts} />
      <circle cx={w} cy={lastY} r="2.5" fill={color} />
    </svg>
  );
}

export function KpiTile({
  label,
  value,
  delta,
  positive,
  sparkValues,
}: {
  label: string;
  value: string;
  delta?: string;
  positive?: boolean;
  sparkValues?: number[];
}) {
  const deltaClass =
    positive === undefined ? "text-muted-foreground" : positive ? "text-[#5fdd9d]" : "text-[#ff5b5b]";
  const sparkColor =
    positive === false ? "#ff5b5b" : positive === true ? "#5fdd9d" : "var(--muted-foreground)";
  return (
    <div className="bg-card px-5 py-[18px]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            {label}
          </div>
          <div className="mt-1.5 font-mono text-[26px] font-semibold tracking-[-0.01em] text-foreground tabular-nums">
            {value}
          </div>
          {delta && (
            <div className={`mt-0.5 font-mono text-[11px] ${deltaClass}`}>
              {delta}
            </div>
          )}
        </div>
        {sparkValues && <Sparkline values={sparkValues} color={sparkColor} />}
      </div>
    </div>
  );
}
