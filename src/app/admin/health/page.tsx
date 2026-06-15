import { fetchPlatformKpis, fetchTenantHealth, fetchTrendSeries, type TenantStatus } from "@/lib/platform/reliability";
import { fetchAlertRules } from "@/lib/platform/alerts";
import { fetchServices, fetchSlos, fetchTelemetry } from "@/lib/platform/services";
import { fetchWebhookHealth } from "@/lib/platform/webhooks";
import { fetchCronJobs } from "@/lib/platform/cron-runs";
import { readTopIssues, sentryConfigured } from "@/lib/platform/sentry";
import { fetchEventFeed } from "@/lib/platform/events";
import { ReliabilityDashboard } from "@/components/admin/reliability-dashboard";

// /admin/health — Platform Reliability. The admin layout already gates this to
// platform admins, so no extra auth here. Ops data → always fresh.

const PAGE_SIZE = 25;

export default async function HealthPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(0, Number(sp.page ?? 0) || 0);
  const status = (["operational", "degraded", "down"].includes(sp.status ?? "")
    ? sp.status
    : "all") as TenantStatus | "all";
  const q = sp.q ?? "";

  const [kpis, tenants, trend, alertRules, services, slos, telemetry, webhooks, cronJobs, issues, events] = await Promise.all([
    fetchPlatformKpis(),
    fetchTenantHealth({ status, search: q, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    fetchTrendSeries(24),
    fetchAlertRules(),
    fetchServices(),
    fetchSlos(),
    fetchTelemetry(),
    fetchWebhookHealth(24),
    fetchCronJobs(),
    readTopIssues(),
    fetchEventFeed(40),
  ]);

  return (
    <ReliabilityDashboard
      kpis={kpis}
      tenants={tenants}
      trend={trend}
      alertRules={alertRules}
      services={services}
      slos={slos}
      telemetry={telemetry}
      webhooks={webhooks}
      cronJobs={cronJobs}
      issues={issues}
      sentryConfigured={sentryConfigured()}
      events={events}
      filter={{ status, q, page }}
      pageSize={PAGE_SIZE}
    />
  );
}
