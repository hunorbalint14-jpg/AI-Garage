import { fetchPlatformKpis, fetchTenantHealth, fetchTrendSeries, type TenantStatus } from "@/lib/platform/reliability";
import { fetchActiveIncidents } from "@/lib/platform/incidents";
import { fetchAlertRules } from "@/lib/platform/alerts";
import { fetchServices, fetchSlos, fetchTelemetry } from "@/lib/platform/services";
import { fetchWebhookHealth } from "@/lib/platform/webhooks";
import { ReliabilityDashboard } from "@/components/admin/reliability-dashboard";

// /admin/health — Platform Reliability. The admin layout already gates this to
// platform admins, so no extra auth here. Ops data → always fresh.
export const dynamic = "force-dynamic";
export const revalidate = 0;

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

  const [kpis, tenants, trend, incidents, alertRules, services, slos, telemetry, webhooks] = await Promise.all([
    fetchPlatformKpis(),
    fetchTenantHealth({ status, search: q, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    fetchTrendSeries(24),
    fetchActiveIncidents(),
    fetchAlertRules(),
    fetchServices(),
    fetchSlos(),
    fetchTelemetry(),
    fetchWebhookHealth(24),
  ]);

  return (
    <ReliabilityDashboard
      kpis={kpis}
      tenants={tenants}
      trend={trend}
      incidents={incidents}
      alertRules={alertRules}
      services={services}
      slos={slos}
      telemetry={telemetry}
      webhooks={webhooks}
      filter={{ status, q, page }}
      pageSize={PAGE_SIZE}
    />
  );
}
