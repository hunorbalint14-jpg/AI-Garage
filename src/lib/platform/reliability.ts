import { createAdminClient } from "@/lib/supabase/admin";
import { readSentrySnapshot } from "@/lib/platform/sentry";

// Read-side aggregations for /admin/health. All reads use the service-role
// client (bypasses RLS) — server-only, never import in client code.
//
// Covers everything derivable from the synthetic uptime store (tenant roster,
// status counts, availability/p95 KPIs + trends) plus the Sentry cache (error
// rate, 24h error count). Request volume (Vercel) arrives in a later PR.

export type TenantStatus = "operational" | "degraded" | "down";

export type TenantHealth = {
  locationId: string;
  slug: string;
  orgName: string;
  host: string;
  status: TenantStatus;
  p95Ms: number | null;
  uptime24h: number | null;
  lastCheckedAt: string | null;
};

const STATUS_RANK: Record<TenantStatus, number> = { down: 0, degraded: 1, operational: 2 };

// ── tenant roster (server-side paginated + filtered) ─────────────────────────
export async function fetchTenantHealth(opts: {
  status?: TenantStatus | "all";
  search?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<{ rows: TenantHealth[]; total: number }> {
  const admin = createAdminClient();
  const { status = "all", search, limit = 25, offset = 0 } = opts;

  let q = admin
    .from("platform_tenant_health")
    .select("location_id, slug, org_name, host, status, p95_ms, uptime_24h, last_checked_at", { count: "exact" });

  if (status !== "all") q = q.eq("status", status);
  if (search) q = q.or(`slug.ilike.%${search}%,org_name.ilike.%${search}%`);

  const { data, count } = await q.range(offset, offset + limit - 1);

  const rows = (data ?? []).map((r) => ({
    locationId: r.location_id as string,
    slug: r.slug as string,
    orgName: r.org_name as string,
    host: r.host as string,
    status: (r.status as TenantStatus) ?? "operational",
    p95Ms: r.p95_ms as number | null,
    uptime24h: r.uptime_24h as number | null,
    lastCheckedAt: r.last_checked_at as string | null,
  }));
  rows.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.slug.localeCompare(b.slug));
  return { rows, total: count ?? rows.length };
}

export type StatusCounts = { total: number; operational: number; degraded: number; down: number };

// All-tenant status breakdown (one light column over the whole roster).
export async function fetchStatusCounts(): Promise<StatusCounts> {
  const admin = createAdminClient();
  const { data } = await admin.from("platform_tenant_health").select("status");
  const counts: StatusCounts = { total: 0, operational: 0, degraded: 0, down: 0 };
  for (const r of data ?? []) {
    counts.total += 1;
    const s = (r.status as TenantStatus) ?? "operational";
    counts[s] += 1;
  }
  return counts;
}

export type PlatformKpis = {
  uptime: number | null; // % over the most recent rollup window
  p95: number | null; // ms, worst target in the window
  errorRate: number | null; // Sentry transaction failure rate %, null if no tracing
  errors24h: number | null; // Sentry total error events in the last 24h
  reqPerMin: number | null; // Vercel — later PR
  activeIncidents: number;
} & StatusCounts;

export async function fetchPlatformKpis(): Promise<PlatformKpis> {
  const admin = createAdminClient();
  const counts = await fetchStatusCounts();
  const sentry = await readSentrySnapshot(admin);

  // Platform availability + p95 from the last few hourly rollup buckets.
  const since = new Date(Date.now() - 3 * 3_600_000).toISOString();
  const { data: roll } = await admin
    .from("uptime_rollup")
    .select("samples, ok_samples, p95_ms, bucket_hour")
    .gte("bucket_hour", since);
  const samples = (roll ?? []).reduce((s, r) => s + Number(r.samples), 0);
  const ok = (roll ?? []).reduce((s, r) => s + Number(r.ok_samples), 0);
  const p95 = (roll ?? []).reduce((m, r) => Math.max(m, Number(r.p95_ms ?? 0)), 0);

  const { count: activeIncidents } = await admin
    .from("incidents")
    .select("id", { count: "exact", head: true })
    .is("resolved_at", null);

  return {
    uptime: samples ? Math.round((10000 * ok) / samples) / 100 : null,
    p95: roll && roll.length ? p95 : null,
    errorRate: sentry?.errorRatePct ?? null,
    errors24h: sentry?.events24h ?? null,
    reqPerMin: null,
    activeIncidents: activeIncidents ?? 0,
    ...counts,
  };
}

export type TrendSeries = { availability: number[]; p95: number[]; labels: string[] };

// Hourly availability% + worst-target p95 over the last `hours`, from the
// rollup. Empty until the first hourly /api/cron/tick rollup runs.
export async function fetchTrendSeries(hours = 24): Promise<TrendSeries> {
  const admin = createAdminClient();
  const since = new Date(Date.now() - hours * 3_600_000).toISOString();
  const { data } = await admin
    .from("uptime_rollup")
    .select("bucket_hour, samples, ok_samples, p95_ms")
    .gte("bucket_hour", since)
    .order("bucket_hour", { ascending: true });

  const byHour = new Map<string, { samples: number; ok: number; p95: number }>();
  for (const r of data ?? []) {
    const key = new Date(r.bucket_hour as string).toISOString();
    const cur = byHour.get(key) ?? { samples: 0, ok: 0, p95: 0 };
    cur.samples += Number(r.samples);
    cur.ok += Number(r.ok_samples);
    cur.p95 = Math.max(cur.p95, Number(r.p95_ms ?? 0));
    byHour.set(key, cur);
  }
  const keys = [...byHour.keys()].sort();
  return {
    availability: keys.map((k) => {
      const v = byHour.get(k)!;
      return v.samples ? Math.round((10000 * v.ok) / v.samples) / 100 : 100;
    }),
    p95: keys.map((k) => byHour.get(k)!.p95),
    labels: keys.map((k) => new Date(k).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })),
  };
}
