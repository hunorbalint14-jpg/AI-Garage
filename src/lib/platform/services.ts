import { createAdminClient } from "@/lib/supabase/admin";
import { readSentrySnapshot, sentryConfigured } from "@/lib/platform/sentry";

// Reads for the dashboard's "Services" section — DB health, platform service
// cards, SLO budgets, telemetry sources. From data we own (synthetic uptime +
// Postgres stats) plus the cached Sentry snapshot; Vercel lights up in a later
// PR.

export type Tone = "operational" | "degraded" | "down";

export type DbHealth = { used: number; max: number; pct: number } | null;

export async function fetchDbHealth(admin = createAdminClient()): Promise<DbHealth> {
  const { data, error } = await admin.rpc("platform_db_health");
  if (error || !data || !data[0]) return null;
  const row = data[0] as { used: number; max: number; pct: number };
  return { used: Number(row.used), max: Number(row.max), pct: Number(row.pct) };
}

export type ServiceCard = {
  key: string;
  name: string;
  vendor: string;
  status: Tone;
  latencyMs: number | null;
  lastCheckedAt: string | null;
  detail: string;
};

function endpointTone(ok: boolean | null, latency: number | null): Tone {
  if (ok === false) return "down";
  if (ok === null) return "down";
  if (latency != null && latency > 800) return "degraded";
  return "operational";
}

// Latest sample for each platform endpoint target + DB + cron freshness.
export async function fetchServices(admin = createAdminClient()): Promise<ServiceCard[]> {
  const cards: ServiceCard[] = [];

  // web + auth from the latest endpoint uptime samples.
  for (const [key, name, vendor] of [
    ["web", "Web app", "Vercel Edge"],
    ["auth", "Auth", "Supabase Auth"],
  ] as const) {
    const { data } = await admin
      .from("uptime_checks")
      .select("ok, latency_ms, checked_at")
      .eq("target_kind", "endpoint")
      .eq("target_key", key)
      .order("checked_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const ok = (data?.ok as boolean | null) ?? null;
    const latency = (data?.latency_ms as number | null) ?? null;
    cards.push({
      key,
      name,
      vendor,
      status: data ? endpointTone(ok, latency) : "down",
      latencyMs: latency,
      lastCheckedAt: (data?.checked_at as string | null) ?? null,
      detail: data ? "synthetic check" : "no checks yet",
    });
  }

  // Database from the pool RPC.
  const db = await fetchDbHealth(admin);
  cards.push({
    key: "db",
    name: "Database",
    vendor: "Supabase Postgres",
    status: db ? (db.pct >= 90 ? "down" : db.pct >= 75 ? "degraded" : "operational") : "down",
    latencyMs: null,
    lastCheckedAt: new Date().toISOString(),
    detail: db ? `${db.used}/${db.max} connections (${db.pct}%)` : "unavailable",
  });

  // Cron freshness — when did the uptime probe last write?
  const { data: lastCheck } = await admin
    .from("uptime_checks")
    .select("checked_at")
    .order("checked_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const lastAt = (lastCheck?.checked_at as string | null) ?? null;
  const ageMin = lastAt ? (Date.now() - new Date(lastAt).getTime()) / 60000 : Infinity;
  cards.push({
    key: "cron",
    name: "Scheduler",
    vendor: "Vercel Cron",
    status: ageMin <= 6 ? "operational" : ageMin <= 20 ? "degraded" : "down",
    latencyMs: null,
    lastCheckedAt: lastAt,
    detail: lastAt ? "uptime probe" : "no runs yet",
  });

  return cards;
}

export type Slo = { name: string; target: number; current: number | null; budgetPct: number | null; window: string };

// Error-budget remaining (%) for an availability-style SLO.
function budget(current: number, target: number): number {
  if (target >= 100) return current >= 100 ? 100 : 0;
  return Math.max(0, Math.min(100, 100 - ((100 - current) / (100 - target)) * 100));
}

// SLOs derived from the 24h rollup: API availability + p95-under-800 compliance.
export async function fetchSlos(admin = createAdminClient()): Promise<Slo[]> {
  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const { data } = await admin
    .from("uptime_rollup")
    .select("samples, ok_samples, p95_ms")
    .gte("bucket_hour", since);
  const rows = (data ?? []) as { samples: number; ok_samples: number; p95_ms: number | null }[];

  if (rows.length === 0) {
    return [
      { name: "API availability", target: 99.9, current: null, budgetPct: null, window: "24h" },
      { name: "Synthetic p95 < 800ms", target: 99.0, current: null, budgetPct: null, window: "24h" },
    ];
  }

  const samples = rows.reduce((s, r) => s + Number(r.samples), 0);
  const ok = rows.reduce((s, r) => s + Number(r.ok_samples), 0);
  const availability = samples ? Math.round((10000 * ok) / samples) / 100 : 100;

  const buckets = rows.filter((r) => r.p95_ms != null);
  const under = buckets.filter((r) => Number(r.p95_ms) <= 800).length;
  const p95Compliance = buckets.length ? Math.round((10000 * under) / buckets.length) / 100 : 100;

  return [
    { name: "API availability", target: 99.9, current: availability, budgetPct: budget(availability, 99.9), window: "24h" },
    { name: "Synthetic p95 < 800ms", target: 99.0, current: p95Compliance, budgetPct: budget(p95Compliance, 99.0), window: "24h" },
  ];
}

export type TelemetrySource = { name: string; detail: string; feeds: string; status: Tone | "pending"; last: string };

export async function fetchTelemetry(admin = createAdminClient()): Promise<TelemetrySource[]> {
  const { data: lastCheck } = await admin
    .from("uptime_checks")
    .select("checked_at")
    .order("checked_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const lastAt = (lastCheck?.checked_at as string | null) ?? null;
  const ageMin = lastAt ? (Date.now() - new Date(lastAt).getTime()) / 60000 : Infinity;
  const syntheticStatus: Tone = ageMin <= 6 ? "operational" : ageMin <= 20 ? "degraded" : "down";
  const lastLabel = lastAt ? `${Math.max(0, Math.round((Date.now() - new Date(lastAt).getTime()) / 1000))}s ago` : "never";

  const db = await fetchDbHealth(admin);

  // Sentry: pending until configured, then live from the cached snapshot the
  // uptime cron refreshes.
  const sentry = await readSentrySnapshot(admin);
  let sentryStatus: Tone | "pending" = "pending";
  let sentryLast = "—";
  if (sentryConfigured() && sentry) {
    const ageMin = sentry.fetchedAt ? (Date.now() - new Date(sentry.fetchedAt).getTime()) / 60000 : Infinity;
    sentryStatus = !sentry.ok || ageMin > 20 ? "down" : ageMin > 6 ? "degraded" : "operational";
    sentryLast = sentry.fetchedAt
      ? `${Math.max(0, Math.round((Date.now() - new Date(sentry.fetchedAt).getTime()) / 1000))}s ago`
      : "never";
  }

  return [
    { name: "Synthetic uptime checks", detail: "every ~3 min · /api/health", feeds: "availability · latency", status: syntheticStatus, last: lastLabel },
    { name: "Supabase", detail: "Postgres · pg_stat_activity", feeds: "DB connections", status: db ? (db.pct >= 90 ? "down" : db.pct >= 75 ? "degraded" : "operational") : "down", last: "just now" },
    { name: "Sentry", detail: "errors · issues", feeds: "error rate · issues", status: sentryStatus, last: sentryLast },
    { name: "Vercel", detail: "analytics · deployments", feeds: "traffic · p95 · builds", status: "pending", last: "—" },
  ];
}
