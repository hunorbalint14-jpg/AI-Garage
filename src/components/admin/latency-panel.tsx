import Link from "next/link";
import type { LatencyMetrics } from "@/lib/platform/reliability";

const ms = (v: number | null) => (v == null ? "—" : `${v}ms`);

// Colour a latency value by rough intra-region thresholds (green/amber/red).
function tone(v: number | null, warn: number, bad: number): string {
  if (v == null) return "text-white";
  if (v >= bad) return "text-[#ff7b7b]";
  if (v >= warn) return "text-[#f5c451]";
  return "text-[#5fdd9d]";
}

function StatTile({ label, value, valueTone }: { label: string; value: string; valueTone?: string }) {
  return (
    <div className="rounded-xl border border-[#23272f] bg-[#15181d] px-4 py-3">
      <div className="text-[10.5px] font-semibold uppercase tracking-wide text-[#5a6170]">{label}</div>
      <div className={`mt-1.5 font-mono text-xl font-semibold tabular-nums leading-none ${valueTone ?? "text-white"}`}>
        {value}
      </div>
    </div>
  );
}

// Real-latency panel for /admin/health. Distinct from the uptime KPIs (which
// probe a DB-free liveness endpoint): this is the actual stack cost — the
// function's hop to Postgres/Redis, plus per-tenant backend latency from the
// DB-touching /api/health/deep probe.
export function LatencyPanel({ latency }: { latency: LatencyMetrics }) {
  const { infra, tenant, slowestTenants } = latency;
  const empty = infra.samples === 0 && tenant.samples === 0;

  return (
    <div>
      <h2 className="mb-1 text-sm font-semibold">Real latency · 24h</h2>
      <p className="mb-3 text-xs text-[#5a6170]">
        Actual stack cost, not the DB-free liveness probe. <span className="text-[#9aa1ad]">Infra</span> = this
        function&apos;s round-trip to Postgres / Redis; <span className="text-[#9aa1ad]">tenant render</span> = per-org
        backend latency from <span className="font-mono">/api/health/deep</span>.
      </p>

      {empty ? (
        <div className="rounded-xl border border-[#23272f] bg-[#15181d] px-4 py-6 text-center text-sm text-[#5a6170]">
          No samples yet — the uptime cron writes these every few minutes.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
            <StatTile label="DB p50" value={ms(infra.dbP50)} valueTone={tone(infra.dbP50, 30, 100)} />
            <StatTile label="DB p95" value={ms(infra.dbP95)} valueTone={tone(infra.dbP95, 50, 150)} />
            <StatTile label="Redis p50" value={ms(infra.redisP50)} valueTone={tone(infra.redisP50, 30, 100)} />
            <StatTile label="Redis p95" value={ms(infra.redisP95)} valueTone={tone(infra.redisP95, 50, 150)} />
            <StatTile label="Tenant render p95" value={ms(tenant.totalP95)} valueTone={tone(tenant.totalP95, 400, 800)} />
          </div>

          <h3 className="mt-4 mb-2 text-xs font-semibold uppercase tracking-wide text-[#5a6170]">
            Slowest tenants · render p95
          </h3>
          <div className="overflow-x-auto rounded-xl border border-[#23272f]">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-[#15181d] text-xs text-[#9aa1ad]">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Tenant</th>
                  <th className="px-3 py-2 text-right font-medium">Render p95</th>
                  <th className="px-3 py-2 text-right font-medium">DB p95</th>
                  <th className="px-3 py-2 text-right font-medium">Samples</th>
                </tr>
              </thead>
              <tbody>
                {slowestTenants.map((t) => (
                  <tr key={t.organizationId} className="border-t border-[#23272f] hover:bg-white/[0.02]">
                    <td className="px-3 py-2">
                      <Link href={`/admin/orgs/${t.organizationId}`} className="text-white hover:underline">
                        {t.slug ?? t.organizationId}
                      </Link>
                    </td>
                    <td className={`px-3 py-2 text-right font-mono tabular-nums ${tone(t.renderP95, 400, 800)}`}>{ms(t.renderP95)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-[#9aa1ad]">{ms(t.dbP95)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-[#5a6170]">{t.samples}</td>
                  </tr>
                ))}
                {slowestTenants.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-sm text-[#5a6170]">
                      No tenant render samples yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
