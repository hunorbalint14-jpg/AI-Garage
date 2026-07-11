"use client";

import { useMemo, useRef, useState } from "react";

// KPI tiles + timeseries for /admin/traffic. Client component: the visitors /
// page-views tiles swap the chart metric, and the chart carries a crosshair
// tooltip. Series arrive fully computed from the server page.

type Series = { cur: number[]; prev: number[] };

export type TrafficChartProps = {
  buckets: string[];
  visitors: Series;
  pageviews: Series;
  tiles: {
    visitors: { value: string; delta: number | null };
    pageviews: { value: string; delta: number | null };
    viewsPerVisit: { value: string; prev: string };
    tenants: { value: string; total: string };
    conv: { value: string; prev: string | null };
  };
};

const SERIES_COLOR = "#16a34a"; // validated on #15181d (dataviz six-checks)
const GHOST_COLOR = "#5a6170";

function Delta({ pct, suffix = "% vs prev" }: { pct: number | null; suffix?: string }) {
  if (pct === null) return <div className="mt-0.5 text-[11.5px] text-[#5a6170]">no previous data</div>;
  const up = pct >= 0;
  return (
    <div className={`mt-0.5 text-[11.5px] tabular-nums ${up ? "text-[#5fdd9d]" : "text-[#ff7b7b]"}`}>
      {up ? "▲" : "▼"} {Math.abs(pct)}
      {suffix}
    </div>
  );
}

function Tile({
  label,
  value,
  active,
  onClick,
  children,
}: {
  label: string;
  value: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
  children?: React.ReactNode;
}) {
  const cls = `rounded-xl border px-4 py-3 text-left ${
    active
      ? "border-[#2a5a3a] bg-gradient-to-b from-[#141d17] to-[#15181d]"
      : "border-[#23272f] bg-[#15181d]"
  } ${onClick ? "cursor-pointer transition-colors hover:border-[#2a2f37]" : ""}`;
  const inner = (
    <>
      <div className="text-[11px] uppercase tracking-wide text-[#5a6170]">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-white">{value}</div>
      {children}
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className={cls}>
      {inner}
    </button>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

export function TrafficChart({ buckets, visitors, pageviews, tiles }: TrafficChartProps) {
  const [metric, setMetric] = useState<"visitors" | "pageviews">("visitors");
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const data = metric === "visitors" ? visitors : pageviews;
  const n = buckets.length;

  const geom = useMemo(() => {
    const W = 1000, H = 240, padL = 46, padR = 14, padT = 12, padB = 24;
    const max = Math.max(1, ...data.cur, ...data.prev) * 1.12;
    const iw = W - padL - padR, ih = H - padT - padB;
    const x = (i: number) => padL + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
    const y = (v: number) => padT + ih - (v / max) * ih;
    const path = (arr: number[], close = false) => {
      let d = arr.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join("");
      if (close) d += `L${x(n - 1).toFixed(1)} ${padT + ih}L${padL} ${padT + ih}Z`;
      return d;
    };
    return { W, H, padL, padR, padT, padB, max, iw, ih, x, y, path };
  }, [data, n]);

  const gridLines = [0, 1, 2, 3, 4].map((g) => ({
    y: geom.padT + (geom.ih * g) / 4,
    v: Math.round(geom.max - (geom.max * g) / 4),
  }));
  const xLabelEvery = Math.max(1, Math.floor(n / 5));

  return (
    <div className="flex flex-col gap-3.5">
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 lg:grid-cols-5">
        <Tile
          label="Unique visitors"
          value={tiles.visitors.value}
          active={metric === "visitors"}
          onClick={() => setMetric("visitors")}
        >
          <Delta pct={tiles.visitors.delta} />
        </Tile>
        <Tile
          label="Page views"
          value={tiles.pageviews.value}
          active={metric === "pageviews"}
          onClick={() => setMetric("pageviews")}
        >
          <Delta pct={tiles.pageviews.delta} />
        </Tile>
        <Tile label="Views / visit" value={tiles.viewsPerVisit.value}>
          <div className="mt-0.5 text-[11.5px] text-[#5a6170]">prev {tiles.viewsPerVisit.prev}</div>
        </Tile>
        <Tile
          label="Tenants with traffic"
          value={
            <>
              {tiles.tenants.value}
              <span className="text-sm font-medium text-[#5a6170]"> / {tiles.tenants.total}</span>
            </>
          }
        />
        <Tile label="Booking conversion" value={tiles.conv.value}>
          {tiles.conv.prev !== null && <div className="mt-0.5 text-[11.5px] text-[#5a6170]">prev {tiles.conv.prev}</div>}
        </Tile>
      </div>

      <div className="rounded-xl border border-[#23272f] bg-[#15181d] p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-[13px] font-semibold">
            {metric === "visitors" ? "Unique visitors" : "Page views"}
            <span className="ml-2 text-[11px] font-normal text-[#5a6170]">bots excluded</span>
          </h2>
          <div className="flex gap-4 text-[11px] text-[#9aa1ad]">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-[3px] w-3.5 rounded" style={{ background: SERIES_COLOR }} />
              Current
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3.5 border-t-2 border-dashed" style={{ borderColor: GHOST_COLOR }} />
              Previous period
            </span>
          </div>
        </div>
        <div className="relative mt-2">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${geom.W} ${geom.H}`}
            className="block w-full"
            role="img"
            aria-label={`${metric} per ${n === 24 ? "hour" : "day"}, current vs previous period`}
            onMouseMove={(e) => {
              const rect = svgRef.current?.getBoundingClientRect();
              if (!rect) return;
              const px = ((e.clientX - rect.left) / rect.width) * geom.W;
              const i = Math.round(((px - geom.padL) / geom.iw) * (n - 1));
              setHover(Math.max(0, Math.min(n - 1, i)));
            }}
            onMouseLeave={() => setHover(null)}
          >
            {gridLines.map((g) => (
              <g key={g.y}>
                <line x1={geom.padL} x2={geom.W - geom.padR} y1={g.y} y2={g.y} stroke="#1e2228" strokeWidth={1} />
                <text x={geom.padL - 8} y={g.y + 3} textAnchor="end" fill="#5a6170" fontSize={10} className="font-mono">
                  {g.v.toLocaleString("en-GB")}
                </text>
              </g>
            ))}
            {buckets.map((b, i) =>
              i % xLabelEvery === 0 ? (
                <text key={b} x={geom.x(i)} y={geom.H - 6} textAnchor="middle" fill="#5a6170" fontSize={10} className="font-mono">
                  {n === 24 ? b : b.slice(5)}
                </text>
              ) : null,
            )}
            <path d={geom.path(data.cur, true)} fill={SERIES_COLOR} opacity={0.1} />
            <path d={geom.path(data.prev)} fill="none" stroke={GHOST_COLOR} strokeWidth={1.5} strokeDasharray="4 4" opacity={0.8} />
            <path d={geom.path(data.cur)} fill="none" stroke={SERIES_COLOR} strokeWidth={2} strokeLinejoin="round" />
            <circle cx={geom.x(n - 1)} cy={geom.y(data.cur[n - 1] ?? 0)} r={3.5} fill={SERIES_COLOR} stroke="#15181d" strokeWidth={2} />
            {hover !== null && (
              <g>
                <line x1={geom.x(hover)} x2={geom.x(hover)} y1={geom.padT} y2={geom.padT + geom.ih} stroke="#5a6170" strokeWidth={1} opacity={0.35} />
                <circle cx={geom.x(hover)} cy={geom.y(data.cur[hover] ?? 0)} r={4} fill={SERIES_COLOR} stroke="#15181d" strokeWidth={2} />
                <circle cx={geom.x(hover)} cy={geom.y(data.prev[hover] ?? 0)} r={3.5} fill={GHOST_COLOR} stroke="#15181d" strokeWidth={2} />
              </g>
            )}
          </svg>
          {hover !== null && (
            <div
              className="pointer-events-none absolute top-1 z-10 min-w-[150px] rounded-lg border border-[#2a2f37] bg-[#0c0e12] px-2.5 py-2 text-[11.5px] shadow-xl"
              style={{ left: `clamp(0px, calc(${((geom.x(hover) / geom.W) * 100).toFixed(1)}% - 75px), calc(100% - 155px))` }}
            >
              <div className="font-mono text-[10px] tracking-wide text-[#5a6170]">{buckets[hover]}</div>
              <div className="mt-1 flex justify-between gap-4">
                <span style={{ color: SERIES_COLOR }}>● current</span>
                <b className="tabular-nums text-white">{(data.cur[hover] ?? 0).toLocaleString("en-GB")}</b>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-[#5a6170]">○ previous</span>
                <b className="tabular-nums text-[#9aa1ad]">{(data.prev[hover] ?? 0).toLocaleString("en-GB")}</b>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
