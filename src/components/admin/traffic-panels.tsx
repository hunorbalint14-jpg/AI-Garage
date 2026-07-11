// Server-rendered traffic widgets shared by /admin/traffic and the org detail
// page (#admin/traffic PR 3). No client JS — plain SVG + divs.

export const TRAFFIC_SPARK_COLOR = "#3987e5"; // validated on #15181d

export function Sparkline({ points, w = 84, h = 22 }: { points: number[]; w?: number; h?: number }) {
  const max = Math.max(...points, 1);
  const min = Math.min(...points);
  const pts = points
    .map(
      (v, i) =>
        `${((i / Math.max(1, points.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - min) / Math.max(1, max - min)) * (h - 4)).toFixed(1)}`,
    )
    .join(" ");
  return (
    <svg width={w} height={h} aria-hidden className="inline-block align-middle">
      <polyline points={pts} fill="none" stroke={TRAFFIC_SPARK_COLOR} strokeWidth={1.5} />
    </svg>
  );
}

export function RankPanel({
  title,
  sub,
  rows,
  tabs,
}: {
  title: string;
  sub: string;
  rows: [string, number][];
  tabs?: React.ReactNode;
}) {
  const max = Math.max(...rows.map(([, v]) => v), 1);
  return (
    <div className="rounded-xl border border-[#23272f] bg-[#15181d] p-4">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <h2 className="text-[13px] font-semibold">{title}</h2>
          <p className="mt-0.5 mb-3 text-[11px] text-[#5a6170]">{sub}</p>
        </div>
        {tabs}
      </div>
      <div className="flex flex-col gap-1">
        {rows.map(([label, v]) => (
          <div key={label} className="relative flex items-center justify-between gap-3 rounded-md px-2 py-1.5">
            <div
              className="absolute inset-0 rounded-md bg-[#3987e5]/[0.18]"
              style={{ width: `${((v / max) * 100).toFixed(1)}%` }}
            />
            <span className="relative z-[1] min-w-0 truncate text-[12.5px]">{label}</span>
            <span className="relative z-[1] flex-none font-mono text-[11.5px] tabular-nums text-[#9aa1ad]">
              {v.toLocaleString("en-GB")}
            </span>
          </div>
        ))}
        {rows.length === 0 && <div className="py-5 text-center text-xs text-[#5a6170]">No data in this window yet.</div>}
      </div>
    </div>
  );
}
