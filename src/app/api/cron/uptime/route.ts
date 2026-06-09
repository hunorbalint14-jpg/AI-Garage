import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeEqual } from "@/lib/safe-equal";
import { evaluateAlerts } from "@/lib/platform/alerts";

export const runtime = "nodejs";
export const maxDuration = 60;

// Synthetic uptime/latency probe. Runs every few minutes via Vercel Cron: pings
// every location subdomain + core platform endpoints, records one sample per
// target. Alert evaluation / auto-incident lands in a later PR.
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
  location_id: string | null;
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

  const { data: locations } = await admin
    .from("locations")
    .select("id, slug")
    .order("slug");

  const tenantTargets = (locations ?? []).map((l) => ({
    kind: "tenant" as const,
    key: l.slug,
    location_id: l.id,
    url: tenantUrl(l.slug),
  }));
  const endpointTargets = PLATFORM_ENDPOINTS.map((e) => ({
    kind: "endpoint" as const,
    key: e.key,
    location_id: null,
    url: e.url,
  }));
  const all = [...endpointTargets, ...tenantTargets];

  const results = await mapLimit(all, CONCURRENCY, async (t) => {
    const r = await probe(t.url);
    return {
      target_kind: t.kind,
      target_key: t.key,
      location_id: t.location_id,
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

  // Evaluate alert rules against this run → Slack + auto-declare incidents.
  const declared = await evaluateAlerts(admin, results);

  const down = results.filter((r) => !r.ok).length;
  console.log("[cron/uptime]", { checked: results.length, down, declared });
  return NextResponse.json({ success: true, checked: results.length, down, declared });
}
