import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeEqual } from "@/lib/safe-equal";
import { evaluateAlerts } from "@/lib/platform/alerts";
import { recordCronRun } from "@/lib/platform/cron-runs";
import { refreshSentry } from "@/lib/platform/sentry";
import { cacheGet, cacheSet } from "@/lib/redis";

export const runtime = "nodejs";
export const maxDuration = 60;

// Synthetic uptime/latency probe. Runs every few minutes via Vercel Cron: pings
// every organization subdomain + core platform endpoints, records one sample per
// target. (The subdomain is the org slug; locations share the one app, so we
// probe once per org.) Alert evaluation / auto-incident lands in a later PR.
//
// Conventions mirror /api/cron/tick: Bearer CRON_SECRET via safeEqual, the
// service-role admin client, JSON summary return.
//
// SCALE: concurrency-capped fan-out. Past ~500 tenants, shard by `minute % N`
// or stagger so one invocation stays within maxDuration.

const CONCURRENCY = 20;
const PER_CHECK_TIMEOUT_MS = 8000;

const ROOT = process.env.ROOT_DOMAIN ?? process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localtest.me:3000";
const ROOT_HOST = ROOT.split(":")[0];
const PORT = ROOT.includes(":") ? `:${ROOT.split(":")[1]}` : "";
const PROTO =
  ROOT_HOST === "localhost" || ROOT_HOST.endsWith("localtest.me") || ROOT_HOST.endsWith(".local") ? "http" : "https";

const tenantUrl = (slug: string) => `${PROTO}://${slug}.${ROOT_HOST}${PORT}/api/health`;

const PLATFORM_ENDPOINTS: { key: string; url: string }[] = [
  { key: "web", url: `${PROTO}://admin.${ROOT_HOST}${PORT}/api/health` },
  { key: "auth", url: `${PROTO}://admin.${ROOT_HOST}${PORT}/api/health/auth` },
];

type Sample = {
  target_kind: "tenant" | "service" | "endpoint";
  target_key: string;
  organization_id: string | null;
  ok: boolean;
  status_code: number | null;
  latency_ms: number | null;
  error: string | null;
};

async function probe(url: string): Promise<{ ok: boolean; status: number | null; ms: number; error: string | null }> {
  const started = performance.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PER_CHECK_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: "GET", redirect: "manual", cache: "no-store", signal: ctrl.signal });
    return { ok: res.status < 500, status: res.status, ms: Math.round(performance.now() - started), error: null };
  } catch (e) {
    return { ok: false, status: null, ms: Math.round(performance.now() - started), error: (e as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

// Minimal concurrency-limited map.
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !safeEqual(authHeader, `Bearer ${process.env.CRON_SECRET}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const __t0 = Date.now();

  const { data: orgs } = await admin
    .from("organizations")
    .select("id, slug")
    .order("slug");

  const tenantTargets = (orgs ?? []).map((o) => ({
    kind: "tenant" as const,
    key: o.slug,
    organization_id: o.id,
    url: tenantUrl(o.slug),
  }));
  const endpointTargets = PLATFORM_ENDPOINTS.map((e) => ({
    kind: "endpoint" as const,
    key: e.key,
    organization_id: null,
    url: e.url,
  }));
  const all = [...endpointTargets, ...tenantTargets];

  const results = await mapLimit(all, CONCURRENCY, async (t) => {
    const r = await probe(t.url);
    return {
      target_kind: t.kind,
      target_key: t.key,
      organization_id: t.organization_id,
      ok: r.ok,
      status_code: r.status,
      latency_ms: r.ms,
      error: r.error,
    } satisfies Sample;
  });

  if (results.length > 0) {
    const { error: insErr } = await admin.from("uptime_checks").insert(results);
    if (insErr) console.error("[cron/uptime] insert failed", insErr.message);
  }

  // ── real latency telemetry (latency_samples) ────────────────────────────────
  // Separate from the DB-free uptime probe above: this captures the actual stack
  // cost so /admin/health shows real responsiveness, not just reachability.
  type LatencyRow = {
    kind: "infra" | "tenant";
    organization_id: string | null;
    target_key: string | null;
    db_ms: number | null;
    redis_ms: number | null;
    total_ms: number | null;
  };
  const latencyRows: LatencyRow[] = [];

  // Infra: time a Postgres round-trip + a Redis round-trip from this in-region
  // function — the hop cost, and a direct check that region co-location worked.
  const tDb = performance.now();
  const { error: dbErr } = await admin.from("organizations").select("id").limit(1);
  const infraDbMs = dbErr ? null : Math.round(performance.now() - tDb);

  const tRedis = performance.now();
  await cacheSet("latency:ping", Date.now(), 30);
  const redisGot = await cacheGet<number>("latency:ping");
  const infraRedisMs = redisGot === null ? null : Math.round(performance.now() - tRedis);

  latencyRows.push({
    kind: "infra",
    organization_id: null,
    target_key: null,
    db_ms: infraDbMs,
    redis_ms: infraRedisMs,
    total_ms: null,
  });

  // Per-tenant: probe the DB-touching deep endpoint → real backend latency
  // (db_ms from the body, total_ms = end-to-end incl. network/TLS).
  const deep = await mapLimit(tenantTargets, CONCURRENCY, async (t) => {
    const started = performance.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PER_CHECK_TIMEOUT_MS);
    try {
      const res = await fetch(`${PROTO}://${t.key}.${ROOT_HOST}${PORT}/api/health/deep`, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        signal: ctrl.signal,
      });
      const total = Math.round(performance.now() - started);
      let dbMs: number | null = null;
      try {
        const body = (await res.json()) as { db_ms?: number };
        if (typeof body?.db_ms === "number") dbMs = body.db_ms;
      } catch {
        // non-JSON / error body — keep db_ms null, still record total
      }
      return { organization_id: t.organization_id, target_key: t.key, db_ms: dbMs, total_ms: total } satisfies Omit<
        LatencyRow,
        "kind" | "redis_ms"
      >;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  });
  for (const d of deep) {
    if (d) latencyRows.push({ kind: "tenant", redis_ms: null, ...d });
  }

  const { error: latErr } = await admin.from("latency_samples").insert(latencyRows);
  if (latErr) console.error("[cron/uptime] latency insert failed", latErr.message);

  // Refresh the Sentry cache first so evaluateAlerts sees a fresh error rate
  // for the error_rate_pct rule (and the dashboard reads it on next render).
  await refreshSentry(admin);

  // Evaluate alert rules against this run → Slack + auto-declare incidents.
  const declared = await evaluateAlerts(admin, results);

  const down = results.filter((r) => !r.ok).length;
  await recordCronRun(admin, "cron/uptime", true, Date.now() - __t0, `checked ${results.length}, down ${down}, declared ${declared}`);
  console.log("[cron/uptime]", { checked: results.length, down, declared });
  return NextResponse.json({ success: true, checked: results.length, down, declared });
}
