import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  fetchTrafficStats,
  RANGE_DAYS,
  type SurfaceFilter,
  type TrafficRange,
  type OrgTrafficRow,
} from "@/lib/platform/traffic-stats";
import { TrafficChart } from "@/components/admin/traffic-chart";

export const dynamic = "force-dynamic";

// /admin/traffic (#admin/traffic PR 2): who visits, per org and overall —
// devices, regions, referrers, pages. Server-rendered from page_view_daily
// rollups + live raw for today; only the KPI/chart block is a client island.

const RANGES: TrafficRange[] = ["24h", "7d", "30d", "90d"];
const SURFACES: { key: SurfaceFilter; label: string }[] = [
  { key: "all", label: "All surfaces" },
  { key: "booking", label: "Booking" },
  { key: "portal", label: "Portal" },
  { key: "docs", label: "Docs links" },
  { key: "marketing", label: "Marketing" },
  { key: "staff", label: "Staff" },
];
const DEVICE_TABS = ["device", "browser", "os"] as const;
const GEO_TABS = ["city", "country"] as const;

// Chart palette — validated against #15181d (dataviz six-checks).
const CAT = ["#3987e5", "#199e70", "#c98500", "#9085e9"];
const SPARK = "#3987e5";

function fmt(n: number): string {
  return n.toLocaleString("en-GB");
}

function qs(over: Record<string, string>, base: Record<string, string>): string {
  const p = new URLSearchParams({ ...base, ...over });
  return `/admin/traffic?${p.toString()}`;
}

function Seg({ items }: { items: { href: string; label: string; on: boolean }[] }) {
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-[#23272f] bg-[#15181d]">
      {items.map((it, i) => (
        <Link
          key={it.label}
          href={it.href}
          className={`px-3 py-1.5 text-xs font-semibold ${i > 0 ? "border-l border-[#23272f]" : ""} ${
            it.on ? "bg-[#22c55e]/10 text-[#5fdd9d]" : "text-[#9aa1ad] hover:text-white"
          }`}
        >
          {it.label}
        </Link>
      ))}
    </div>
  );
}

function Sparkline({ points }: { points: number[] }) {
  const w = 84, h = 22;
  const max = Math.max(...points, 1);
  const min = Math.min(...points);
  const pts = points
    .map((v, i) => `${((i / Math.max(1, points.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - min) / Math.max(1, max - min)) * (h - 4)).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={w} height={h} aria-hidden className="inline-block align-middle">
      <polyline points={pts} fill="none" stroke={SPARK} strokeWidth={1.5} />
    </svg>
  );
}

function RankPanel({ title, sub, rows, tabs }: { title: string; sub: string; rows: [string, number][]; tabs?: React.ReactNode }) {
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
            <div className="absolute inset-0 rounded-md bg-[#3987e5]/[0.18]" style={{ width: `${((v / max) * 100).toFixed(1)}%` }} />
            <span className="relative z-[1] min-w-0 truncate text-[12.5px]">{label}</span>
            <span className="relative z-[1] flex-none font-mono text-[11.5px] tabular-nums text-[#9aa1ad]">{fmt(v)}</span>
          </div>
        ))}
        {rows.length === 0 && <div className="py-5 text-center text-xs text-[#5a6170]">No data in this window yet.</div>}
      </div>
    </div>
  );
}

function DeviceDonut({ rows }: { rows: [string, number][] }) {
  const total = rows.reduce((s, [, v]) => s + v, 0);
  if (total === 0) return null;
  const cx = 60, cy = 60, r = 42, sw = 18;
  const shown = rows.slice(0, 4);
  const starts = shown.reduce<number[]>((acc, [, v]) => [...acc, acc[acc.length - 1] + (v / total) * Math.PI * 2], [-Math.PI / 2]);
  const segs = shown.map(([name, v], i) => {
    const frac = v / total;
    const gap = shown.length > 1 ? 0.04 : 0;
    const b0 = starts[i] + gap / 2;
    const b1 = Math.max(b0 + 0.01, starts[i + 1] - gap / 2);
    const large = b1 - b0 > Math.PI ? 1 : 0;
    const d = `M${(cx + r * Math.cos(b0)).toFixed(2)} ${(cy + r * Math.sin(b0)).toFixed(2)} A${r} ${r} 0 ${large} 1 ${(cx + r * Math.cos(b1)).toFixed(2)} ${(cy + r * Math.sin(b1)).toFixed(2)}`;
    return { name, v, d, color: CAT[i % CAT.length], pct: Math.round(frac * 100) };
  });
  const top = segs[0];
  return (
    <div className="flex items-center gap-4">
      <svg width={120} height={120} role="img" aria-label={segs.map((s) => `${s.name} ${s.pct}%`).join(", ")}>
        {segs.map((s) => (
          <path key={s.name} d={s.d} fill="none" stroke={s.color} strokeWidth={sw}>
            <title>{`${s.name}: ${fmt(s.v)} · ${s.pct}%`}</title>
          </path>
        ))}
        <text x={cx} y={cy - 1} textAnchor="middle" fill="#fff" fontSize={16} fontWeight={650}>
          {top.pct}%
        </text>
        <text x={cx} y={cy + 13} textAnchor="middle" fill="#5a6170" fontSize={8.5} className="font-mono uppercase">
          {top.name}
        </text>
      </svg>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 text-[12px]">
        {segs.map((s) => (
          <div key={s.name} className="flex items-center gap-2">
            <span className="h-2 w-2 flex-none rounded-[3px]" style={{ background: s.color }} />
            <span className="truncate">{s.name}</span>
            <span className="ml-auto font-mono text-[11px] tabular-nums text-[#9aa1ad]">
              {fmt(s.v)} · {s.pct}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function OrgTable({ rows }: { rows: OrgTrafficRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12.5px]">
        <thead>
          <tr className="text-[9.5px] uppercase tracking-[0.08em] text-[#5a6170]">
            <th className="border-b border-[#23272f] px-2.5 py-1.5 text-left font-semibold">Organisation</th>
            <th className="border-b border-[#23272f] px-2.5 py-1.5 text-right font-semibold">Visitors</th>
            <th className="border-b border-[#23272f] px-2.5 py-1.5 text-right font-semibold">Views</th>
            <th className="border-b border-[#23272f] px-2.5 py-1.5 text-right font-semibold">Bookings</th>
            <th className="border-b border-[#23272f] px-2.5 py-1.5 text-right font-semibold">Conv</th>
            <th className="border-b border-[#23272f] px-2.5 py-1.5 text-center font-semibold">Trend</th>
            <th className="border-b border-[#23272f] px-2.5 py-1.5 text-right font-semibold">Δ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.id} className="hover:bg-white/[0.02]">
              <td className="border-b border-[#1e2228] px-2.5 py-2">
                <Link href={`/admin/orgs/${o.id}`} className="font-semibold text-white hover:underline">
                  {o.name}
                </Link>
                <div className="font-mono text-[10.5px] text-[#5a6170]">{o.slug}</div>
              </td>
              <td className="border-b border-[#1e2228] px-2.5 py-2 text-right tabular-nums">{fmt(o.visitors)}</td>
              <td className="border-b border-[#1e2228] px-2.5 py-2 text-right tabular-nums">{fmt(o.pageviews)}</td>
              <td className="border-b border-[#1e2228] px-2.5 py-2 text-right tabular-nums">{fmt(o.bookings)}</td>
              <td className="border-b border-[#1e2228] px-2.5 py-2 text-right tabular-nums">
                {o.convPct !== null ? `${o.convPct}%` : <span className="text-[#5a6170]">—</span>}
              </td>
              <td className="border-b border-[#1e2228] px-2.5 py-2 text-center">
                <Sparkline points={o.spark} />
              </td>
              <td
                className={`border-b border-[#1e2228] px-2.5 py-2 text-right text-[11.5px] tabular-nums ${
                  o.deltaPct === null ? "text-[#5a6170]" : o.deltaPct >= 0 ? "text-[#5fdd9d]" : "text-[#ff7b7b]"
                }`}
              >
                {o.deltaPct === null ? "new" : `${o.deltaPct >= 0 ? "▲" : "▼"} ${Math.abs(o.deltaPct)}%`}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="px-3 py-6 text-center text-sm text-[#5a6170]">
                No tenant traffic in this window yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default async function AdminTrafficPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; surface?: string; dev?: string; geo?: string }>;
}) {
  const sp = await searchParams;
  const range: TrafficRange = RANGES.includes(sp.range as TrafficRange) ? (sp.range as TrafficRange) : "30d";
  const surface: SurfaceFilter = SURFACES.some((s) => s.key === sp.surface) ? (sp.surface as SurfaceFilter) : "all";
  const devTab = DEVICE_TABS.includes(sp.dev as (typeof DEVICE_TABS)[number]) ? (sp.dev as (typeof DEVICE_TABS)[number]) : "device";
  const geoTab = GEO_TABS.includes(sp.geo as (typeof GEO_TABS)[number]) ? (sp.geo as (typeof GEO_TABS)[number]) : "city";

  const admin = createAdminClient();
  const stats = await fetchTrafficStats(admin, range, surface);
  const base = { range, surface, dev: devTab, geo: geoTab };

  const deviceRows = devTab === "device" ? stats.devices : devTab === "browser" ? stats.browsers : stats.oses;
  const geoRows = geoTab === "city" ? stats.cities : stats.countries;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <Seg items={RANGES.map((r) => ({ href: qs({ range: r }, base), label: r, on: r === range }))} />
        <Seg items={SURFACES.map((s) => ({ href: qs({ surface: s.key }, base), label: s.label, on: s.key === surface }))} />
        <span className="ml-auto font-mono text-[10.5px] tracking-wide text-[#5a6170]">
          {range === "24h" ? "LAST 24H · HOURLY" : `LAST ${RANGE_DAYS[range]} DAYS · DAILY`} · VS PREVIOUS PERIOD
        </span>
      </div>

      <TrafficChart
        buckets={stats.buckets}
        visitors={stats.series.visitors}
        pageviews={stats.series.pageviews}
        tiles={{
          visitors: { value: fmt(stats.kpis.visitors), delta: stats.kpis.visitorsDelta },
          pageviews: { value: fmt(stats.kpis.pageviews), delta: stats.kpis.pageviewsDelta },
          viewsPerVisit: { value: String(stats.kpis.viewsPerVisit), prev: String(stats.kpis.viewsPerVisitPrev) },
          tenants: { value: String(stats.kpis.activeTenants), total: String(stats.kpis.tenantsTotal) },
          conv: {
            value: stats.kpis.convPct !== null ? `${stats.kpis.convPct}%` : "—",
            prev: stats.kpis.convPctPrev !== null ? `${stats.kpis.convPctPrev}%` : null,
          },
        }}
      />

      <div className="grid gap-4 lg:grid-cols-[1.9fr_1fr]">
        <div className="rounded-xl border border-[#23272f] bg-[#15181d] p-4">
          <h2 className="text-[13px] font-semibold">Traffic by organisation</h2>
          <p className="mt-0.5 mb-3 text-[11px] text-[#5a6170]">
            Visitors on tenant hosts. Conversion = bookings ÷ booking-page visitors, whatever the surface filter.
          </p>
          <OrgTable rows={stats.orgs} />
        </div>

        <div className="rounded-xl border border-[#23272f] bg-[#15181d] p-4">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-[13px] font-semibold">Devices</h2>
            <div className="flex gap-1">
              {DEVICE_TABS.map((t) => (
                <Link
                  key={t}
                  href={qs({ dev: t }, base)}
                  className={`rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${
                    t === devTab ? "bg-white/[0.06] text-white" : "text-[#5a6170] hover:text-white"
                  }`}
                >
                  {t}
                </Link>
              ))}
            </div>
          </div>
          <p className="mt-0.5 mb-3 text-[11px] text-[#5a6170]">
            {devTab === "os" ? "OS split is computed from the live window only." : "All traffic in the window."}
          </p>
          {devTab === "device" && <DeviceDonut rows={deviceRows} />}
          <div className={devTab === "device" ? "mt-3 border-t border-[#1e2228] pt-3" : ""}>
            {(devTab === "device" ? stats.browsers.slice(0, 6) : deviceRows).map(([label, v]) => (
              <div key={label} className="flex items-center justify-between gap-3 py-1 text-[12.5px]">
                <span className="min-w-0 truncate">{label}</span>
                <span className="font-mono text-[11.5px] tabular-nums text-[#9aa1ad]">{fmt(v)}</span>
              </div>
            ))}
            {deviceRows.length === 0 && <div className="py-5 text-center text-xs text-[#5a6170]">No data in this window yet.</div>}
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <RankPanel title="Top pages" sub="Paths normalised — tokens & ids stripped before storage." rows={stats.paths} />
        <RankPanel
          title="Locations"
          sub="From edge geo headers. IPs are never stored."
          rows={geoRows}
          tabs={
            <div className="flex gap-1">
              {GEO_TABS.map((t) => (
                <Link
                  key={t}
                  href={qs({ geo: t }, base)}
                  className={`rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${
                    t === geoTab ? "bg-white/[0.06] text-white" : "text-[#5a6170] hover:text-white"
                  }`}
                >
                  {t}
                </Link>
              ))}
            </div>
          }
        />
        <RankPanel title="Referrers" sub="External hosts only — same-site navigation dropped." rows={stats.referrers} />
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 rounded-xl border border-[#23272f] bg-[#171b21] px-4 py-2.5 text-[11.5px] text-[#9aa1ad]">
        {[
          ["No cookies", "nothing set on visitors"],
          ["Daily-rotating hash", "visitors uncountable across days"],
          ["IPs never stored", "geo resolved at the edge, then dropped"],
          ["90-day raw retention", "daily rollups kept beyond"],
        ].map(([b, rest]) => (
          <span key={b} className="flex items-center gap-1.5">
            <span className="font-bold text-[#5fdd9d]">✓</span>
            <span>
              <b className="font-semibold text-[#e6e8eb]">{b}</b> — {rest}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
