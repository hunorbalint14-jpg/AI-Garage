import Link from "next/link";
import { TrendChart } from "@/components/admin/reliability-chart";
import { ReliabilityFilters } from "@/components/admin/reliability-filters";
import { AlertsPanel } from "@/components/admin/alerts-panel";
import { ServicesPanel } from "@/components/admin/services-panel";
import { WebhooksPanel } from "@/components/admin/webhooks-panel";
import { JobsPanel } from "@/components/admin/jobs-panel";
import { IssuesPanel } from "@/components/admin/issues-panel";
import { EventsPanel } from "@/components/admin/events-panel";
import type { PlatformKpis, TenantHealth, TrendSeries } from "@/lib/platform/reliability";
import type { AlertRuleView } from "@/lib/platform/alerts";
import type { ServiceCard, Slo, TelemetrySource } from "@/lib/platform/services";
import type { WebhookHealth } from "@/lib/platform/webhooks";
import type { CronJob } from "@/lib/platform/cron-runs";
import type { SentryIssue } from "@/lib/platform/sentry";
import type { PlatformEvent } from "@/lib/platform/events";

type Status = "all" | "operational" | "degraded" | "down";

const STATUS_META: Record<TenantHealth["status"], { label: string; dot: string; text: string }> = {
  operational: { label: "Operational", dot: "bg-[#5fdd9d]", text: "text-[#5fdd9d]" },
  degraded: { label: "Degraded", dot: "bg-[#f5c451]", text: "text-[#f5c451]" },
  down: { label: "Down", dot: "bg-[#ff7b7b]", text: "text-[#ff7b7b]" },
};

function Kpi({ label, value, unit, tone }: { label: string; value: string; unit?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-[#23272f] bg-[#15181d] px-4 py-3">
      <div className="text-[10.5px] font-semibold uppercase tracking-wide text-[#5a6170]">{label}</div>
      <div className={`mt-1.5 font-mono text-2xl font-semibold tabular-nums leading-none ${tone ?? "text-white"}`}>
        {value}
        {unit && <span className="ml-0.5 text-sm font-medium text-[#9aa1ad]">{unit}</span>}
      </div>
    </div>
  );
}

export function ReliabilityDashboard({
  kpis,
  tenants,
  trend,
  alertRules,
  services,
  slos,
  telemetry,
  webhooks,
  cronJobs,
  issues,
  sentryConfigured,
  events,
  filter,
  pageSize,
}: {
  kpis: PlatformKpis;
  tenants: { rows: TenantHealth[]; total: number };
  trend: TrendSeries;
  alertRules: AlertRuleView[];
  services: ServiceCard[];
  slos: Slo[];
  telemetry: TelemetrySource[];
  webhooks: WebhookHealth[];
  cronJobs: CronJob[];
  issues: SentryIssue[];
  sentryConfigured: boolean;
  events: PlatformEvent[];
  filter: { status: Status; q: string; page: number };
  pageSize: number;
}) {
  const start = filter.page * pageSize;
  const showingTo = Math.min(start + tenants.rows.length, tenants.total);
  const hasPrev = filter.page > 0;
  const hasNext = start + pageSize < tenants.total;

  const pageHref = (p: number) => {
    const sp = new URLSearchParams();
    if (filter.status !== "all") sp.set("status", filter.status);
    if (filter.q) sp.set("q", filter.q);
    if (p > 0) sp.set("page", String(p));
    const qs = sp.toString();
    return `/admin/health${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="flex flex-col gap-6">
      <p className="text-[12.5px] text-[#9aa1ad]">Synthetic uptime &amp; latency across every tenant.</p>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        <Kpi label="Availability (1h)" value={kpis.uptime != null ? kpis.uptime.toFixed(2) : "—"} unit={kpis.uptime != null ? "%" : ""} tone="text-[#5fdd9d]" />
        <Kpi
          label="Error rate (5m)"
          value={kpis.errorRate != null ? kpis.errorRate.toFixed(2) : "—"}
          unit={kpis.errorRate != null ? "%" : ""}
          tone={kpis.errorRate == null ? "text-white" : kpis.errorRate > 2 ? "text-[#ff7b7b]" : kpis.errorRate > 1 ? "text-[#f5c451]" : "text-[#5fdd9d]"}
        />
        <Kpi label="p95 latency" value={kpis.p95 != null ? String(kpis.p95) : "—"} unit={kpis.p95 != null ? "ms" : ""} />
        <Kpi label="Active incidents" value={String(kpis.activeIncidents)} tone={kpis.activeIncidents > 0 ? "text-[#ff7b7b]" : "text-white"} />
        <Kpi label="Operational" value={`${kpis.operational}/${kpis.total}`} tone="text-[#5fdd9d]" />
        <Kpi label="Degraded" value={String(kpis.degraded)} tone={kpis.degraded > 0 ? "text-[#f5c451]" : "text-white"} />
        <Kpi label="Down" value={String(kpis.down)} tone={kpis.down > 0 ? "text-[#ff7b7b]" : "text-white"} />
      </div>
      <p className="-mt-3 text-xs text-[#5a6170]">Request volume lands with the Vercel adapter in a later update.</p>

      {/* Trends */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h2 className="mb-2 text-sm font-semibold">Availability · 24h</h2>
          <TrendChart data={trend.availability} tone="ok" suffix="%" />
        </div>
        <div>
          <h2 className="mb-2 text-sm font-semibold">p95 latency · 24h</h2>
          <TrendChart data={trend.p95} tone="info" suffix="ms" />
        </div>
      </div>

      {/* Services (telemetry + service cards + SLOs) */}
      <ServicesPanel telemetry={telemetry} services={services} slos={slos} />

      {/* Scheduled jobs */}
      <JobsPanel jobs={cronJobs} />

      {/* Webhook delivery */}
      <WebhooksPanel webhooks={webhooks} />

      {/* Top issues (Sentry) */}
      <IssuesPanel issues={issues} events24h={kpis.errors24h} configured={sentryConfigured} />

      {/* Alert rules */}
      <AlertsPanel rules={alertRules} />

      {/* Tenant roster */}
      <div>
        <h2 className="mb-2 text-sm font-semibold">Tenants</h2>
        <ReliabilityFilters status={filter.status} q={filter.q} counts={kpis} />
        <div className="overflow-x-auto rounded-xl border border-[#23272f]">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-[#15181d] text-xs text-[#9aa1ad]">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Tenant</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">p95</th>
                <th className="px-3 py-2 text-right font-medium">Uptime 24h</th>
                <th className="px-3 py-2 text-right font-medium">Last checked</th>
              </tr>
            </thead>
            <tbody>
              {tenants.rows.map((t) => {
                const m = STATUS_META[t.status];
                return (
                  <tr key={t.locationId} className="border-t border-[#23272f] hover:bg-white/[0.02]">
                    <td className="px-3 py-2">
                      <div className="font-medium text-white">{t.orgName}</div>
                      <a
                        href={`https://${t.host}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-[10px] text-[#5a6170] hover:text-[#7aa2ff]"
                      >
                        {t.host}
                      </a>
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${m.dot}`} />
                        <span className={`text-xs ${m.text}`}>{m.label}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{t.p95Ms != null ? `${t.p95Ms}ms` : "—"}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{t.uptime24h != null ? `${t.uptime24h}%` : "—"}</td>
                    <td className="px-3 py-2 text-right text-xs text-[#9aa1ad]">
                      {t.lastCheckedAt
                        ? new Date(t.lastCheckedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
                        : "never"}
                    </td>
                  </tr>
                );
              })}
              {tenants.rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-sm text-[#5a6170]">
                    No tenants match. Synthetic checks populate this once the uptime cron has run.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pager */}
        <div className="mt-3 flex items-center justify-between text-xs text-[#9aa1ad]">
          <span>
            {tenants.total > 0 ? `${start + 1}–${showingTo} of ${tenants.total}` : "0 results"}
          </span>
          <div className="flex items-center gap-2">
            {hasPrev ? (
              <Link href={pageHref(filter.page - 1)} className="rounded border border-[#2a2f37] px-2.5 py-1 hover:bg-white/[0.04] hover:text-white">
                ← Prev
              </Link>
            ) : (
              <span className="rounded border border-[#23272f] px-2.5 py-1 opacity-40">← Prev</span>
            )}
            {hasNext ? (
              <Link href={pageHref(filter.page + 1)} className="rounded border border-[#2a2f37] px-2.5 py-1 hover:bg-white/[0.04] hover:text-white">
                Next →
              </Link>
            ) : (
              <span className="rounded border border-[#23272f] px-2.5 py-1 opacity-40">Next →</span>
            )}
          </div>
        </div>
      </div>

      {/* Live events */}
      <EventsPanel events={events} />
    </div>
  );
}
