import { createAdminClient } from "@/lib/supabase/admin";
import { readSentrySnapshot } from "@/lib/platform/sentry";

// Read-side aggregations for /admin/health. All reads use the service-role
// client (bypasses RLS) — server-only, never import in client code.
//
// Covers everything derivable from the synthetic uptime store (tenant roster,
// status counts, availability/p95 KPIs + trends) plus the Sentry cache (error
// rate, 24h error count). Request volume (Vercel) arrives in a later PR.

export type TenantStatus = "operational" | "degraded" | "down";

export type TenantBranch = { id: string; name: string; slug: string };

// One row per ORGANISATION (the subdomain is the org slug). `branches` lists the
// org's locations for the expandable roster row — internal identifiers, not URLs.
export type TenantHealth = {
  organizationId: string;
  slug: string;
  orgName: string;
  host: string;
  status: TenantStatus;
  p95Ms: number | null;
  uptime24h: number | null;
  lastCheckedAt: string | null;
  locationCount: number;
  branches: TenantBranch[];
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
    .select("organization_id, slug, org_name, host, status, p95_ms, uptime_24h, last_checked_at, location_count, branches", { count: "exact" });

  if (status !== "all") q = q.eq("status", status);
  if (search) q = q.or(`slug.ilike.%${search}%,org_name.ilike.%${search}%`);

  const { data, count } = await q.range(offset, offset + limit - 1);

  const rows = (data ?? []).map((r) => ({
    organizationId: r.organization_id as string,
    slug: r.slug as string,
    orgName: r.org_name as string,
    host: r.host as string,
    status: (r.status as TenantStatus) ?? "operational",
    p95Ms: r.p95_ms as number | null,
    uptime24h: r.uptime_24h as number | null,
    lastCheckedAt: r.last_checked_at as string | null,
    locationCount: Number(r.location_count ?? 0),
    branches: (r.branches as TenantBranch[] | null) ?? [],
  }));
  rows.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.slug.localeCompare(b.slug));
  return { rows, total: count ?? rows.length };
}

export type StatusCounts = { total: number; operational: number; degraded: number; down: number };

export type AdminStatusSummary = {
  status: TenantStatus;
  tenantsHealthy: number;
  tenantsTotal: number;
  activeIncidents: number;
};

// Light overall-health roll-up for the admin sidebar's global-status box + the
// incident nav badge. One status query + one incident count.
export async function fetchAdminStatusSummary(): Promise<AdminStatusSummary> {
  const admin = createAdminClient();
  const counts = await fetchStatusCounts();
  const { count } = await admin
    .from("incidents")
    .select("id", { count: "exact", head: true })
    .is("resolved_at", null);
  const activeIncidents = count ?? 0;
  const status: TenantStatus =
    counts.down > 0 ? "down" : counts.degraded > 0 || activeIncidents > 0 ? "degraded" : "operational";
  return { status, tenantsHealthy: counts.operational, tenantsTotal: counts.total, activeIncidents };
}

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

// ── real latency telemetry (latency_samples, written by /api/cron/uptime) ────
// Infra = function→Postgres/Redis hop cost; tenant = per-org backend latency
// from the DB-touching deep probe. Distinct from the uptime KPIs above, which
// measure a DB-free liveness endpoint (reachability/cold-start, not real work).

function percentile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  const idx = Math.min(sortedAsc.length - 1, Math.floor((p / 100) * sortedAsc.length));
  return sortedAsc[idx];
}

export type LatencyMetrics = {
  infra: { dbP50: number | null; dbP95: number | null; redisP50: number | null; redisP95: number | null; samples: number };
  tenant: { totalP50: number | null; totalP95: number | null; dbP95: number | null; samples: number };
  slowestTenants: { organizationId: string; slug: string | null; renderP95: number | null; dbP95: number | null; samples: number }[];
};

export async function fetchLatencyMetrics(hours = 24, topN = 8): Promise<LatencyMetrics> {
  const admin = createAdminClient();
  const since = new Date(Date.now() - hours * 3_600_000).toISOString();
  const { data } = await admin
    .from("latency_samples")
    .select("kind, organization_id, target_key, db_ms, redis_ms, total_ms")
    .gte("checked_at", since)
    .limit(50000);
  const rows = (data ?? []) as {
    kind: "infra" | "tenant";
    organization_id: string | null;
    target_key: string | null;
    db_ms: number | null;
    redis_ms: number | null;
    total_ms: number | null;
  }[];

  const asc = (xs: (number | null)[]) => xs.filter((x): x is number => x != null).sort((a, b) => a - b);
  const infraDb = asc(rows.filter((r) => r.kind === "infra").map((r) => r.db_ms));
  const infraRedis = asc(rows.filter((r) => r.kind === "infra").map((r) => r.redis_ms));
  const tenantTotal = asc(rows.filter((r) => r.kind === "tenant").map((r) => r.total_ms));
  const tenantDb = asc(rows.filter((r) => r.kind === "tenant").map((r) => r.db_ms));

  const byOrg = new Map<string, { slug: string | null; totals: number[]; dbs: number[] }>();
  for (const r of rows) {
    if (r.kind !== "tenant" || !r.organization_id) continue;
    const e = byOrg.get(r.organization_id) ?? { slug: r.target_key, totals: [], dbs: [] };
    if (r.total_ms != null) e.totals.push(r.total_ms);
    if (r.db_ms != null) e.dbs.push(r.db_ms);
    byOrg.set(r.organization_id, e);
  }
  const slowestTenants = [...byOrg.entries()]
    .map(([organizationId, e]) => ({
      organizationId,
      slug: e.slug,
      renderP95: percentile(e.totals.slice().sort((a, b) => a - b), 95),
      dbP95: percentile(e.dbs.slice().sort((a, b) => a - b), 95),
      samples: e.totals.length,
    }))
    .filter((t) => t.renderP95 != null)
    .sort((a, b) => (b.renderP95 ?? 0) - (a.renderP95 ?? 0))
    .slice(0, topN);

  return {
    infra: {
      dbP50: percentile(infraDb, 50),
      dbP95: percentile(infraDb, 95),
      redisP50: percentile(infraRedis, 50),
      redisP95: percentile(infraRedis, 95),
      samples: infraDb.length,
    },
    tenant: {
      totalP50: percentile(tenantTotal, 50),
      totalP95: percentile(tenantTotal, 95),
      dbP95: percentile(tenantDb, 95),
      samples: tenantTotal.length,
    },
    slowestTenants,
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
