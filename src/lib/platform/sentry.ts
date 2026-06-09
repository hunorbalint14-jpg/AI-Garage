import { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

// Sentry adapter for /admin/health (PR 5d). The uptime cron calls refreshSentry
// to pull error rate + top issues into the sentry_snapshot / sentry_issues
// cache; the dashboard KPIs, the Top-issues panel and the error_rate_pct alert
// read the cache (readSentrySnapshot / readTopIssues) — we never hit Sentry on a
// page render.
//
// Live data needs SENTRY_AUTH_TOKEN + SENTRY_ORG + SENTRY_PROJECT. Without them
// (or if Sentry is unreachable) the snapshot stays ok:false and error_rate_pct
// reads null, so the alert stays dormant and the KPI shows "—" — no regression.
//
// Region note: Sentry SaaS routes per-region. Override the API host with
// SENTRY_API_BASE (e.g. https://us.sentry.io) if the default 302s.

const API_BASE = (process.env.SENTRY_API_BASE ?? "https://sentry.io").replace(/\/+$/, "");
const TIMEOUT_MS = 8000;
const ISSUE_LIMIT = 8;

export type SentryIssue = {
  rank: number;
  title: string;
  culprit: string | null;
  level: string | null;
  events: number | null;
  users: number | null;
  lastSeen: string | null; // ISO
  permalink: string | null;
};

export type SentrySnapshot = {
  ok: boolean;
  errorRatePct: number | null;
  events24h: number | null;
  detail: string;
  fetchedAt: string | null;
};

export function sentryConfigured(): boolean {
  return !!(process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT);
}

async function sentryGet(path: string): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${process.env.SENTRY_AUTH_TOKEN}` },
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Sentry ${res.status} on ${path}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Top unresolved issues by 24h frequency. Project-scoped (SENTRY_PROJECT slug).
async function fetchIssues(org: string, project: string): Promise<SentryIssue[]> {
  const qs = new URLSearchParams({ query: "is:unresolved", statsPeriod: "24h", sort: "freq", limit: String(ISSUE_LIMIT) });
  const data = await sentryGet(`/api/0/projects/${org}/${project}/issues/?${qs}`);
  if (!Array.isArray(data)) return [];
  return data.slice(0, ISSUE_LIMIT).map((raw, i) => {
    const o = raw as Record<string, unknown>;
    const meta = (o.metadata ?? {}) as Record<string, unknown>;
    return {
      rank: i + 1,
      title: String(o.title ?? meta.value ?? meta.type ?? "Unknown issue"),
      culprit: o.culprit != null ? String(o.culprit) : null,
      level: o.level != null ? String(o.level) : null,
      events: o.count != null ? Number(o.count) || 0 : null,
      users: o.userCount != null ? Number(o.userCount) || 0 : null,
      lastSeen: o.lastSeen != null ? String(o.lastSeen) : null,
      permalink: o.permalink != null ? String(o.permalink) : null,
    };
  });
}

// Total error events org-wide over the last 24h, via the stats_v2 endpoint.
async function fetchEvents24h(org: string): Promise<number | null> {
  const qs = new URLSearchParams({ field: "sum(quantity)", category: "error", statsPeriod: "24h", interval: "1d" });
  const data = (await sentryGet(`/api/0/organizations/${org}/stats_v2/?${qs}`)) as { groups?: unknown[] };
  if (!Array.isArray(data.groups)) return null;
  let total = 0;
  for (const g of data.groups) {
    const totals = (g as Record<string, unknown>).totals as Record<string, unknown> | undefined;
    total += Number(totals?.["sum(quantity)"] ?? 0) || 0;
  }
  return total;
}

// Transaction failure rate (%) over the last 5 min — Sentry's own ratio of
// failed to total transactions, so we don't need to track request volume
// ourselves. Null when there are no transactions (tracing off) → alert dormant.
async function fetchErrorRatePct(org: string): Promise<number | null> {
  const qs = new URLSearchParams({ field: "failure_rate()", query: "event.type:transaction", statsPeriod: "5m", per_page: "1", project: "-1" });
  const data = (await sentryGet(`/api/0/organizations/${org}/events/?${qs}`)) as { data?: Record<string, unknown>[] };
  const row = Array.isArray(data.data) ? data.data[0] : undefined;
  const rate = row?.["failure_rate()"];
  if (rate == null) return null;
  const n = Number(rate);
  return Number.isFinite(n) ? Math.round(n * 10000) / 100 : null;
}

// Live pull from Sentry → write the cache. Never throws; on any failure the
// snapshot is marked ok:false so downstream reads degrade gracefully. Returns
// the persisted error rate so the cron can feed it straight into alert eval.
export async function refreshSentry(admin: Admin): Promise<{ errorRatePct: number | null }> {
  if (!sentryConfigured()) {
    await writeSnapshot(admin, { ok: false, errorRatePct: null, events24h: null, detail: "not configured" }, []);
    return { errorRatePct: null };
  }

  const org = process.env.SENTRY_ORG!;
  const project = process.env.SENTRY_PROJECT!;

  // Each call is isolated — a missing scope (e.g. no tracing) shouldn't blank
  // the others. The snapshot is "ok" if Sentry was reachable for issues.
  const [issuesR, eventsR, rateR] = await Promise.allSettled([
    fetchIssues(org, project),
    fetchEvents24h(org),
    fetchErrorRatePct(org),
  ]);

  const issues = issuesR.status === "fulfilled" ? issuesR.value : [];
  const events24h = eventsR.status === "fulfilled" ? eventsR.value : null;
  const errorRatePct = rateR.status === "fulfilled" ? rateR.value : null;
  const ok = issuesR.status === "fulfilled" || eventsR.status === "fulfilled" || rateR.status === "fulfilled";

  const detail = ok
    ? `${issues.length} issues${events24h != null ? ` · ${events24h} events/24h` : ""}`
    : `unreachable: ${issuesR.status === "rejected" ? (issuesR.reason as Error).message : "unknown"}`;

  await writeSnapshot(admin, { ok, errorRatePct, events24h, detail }, issues);
  return { errorRatePct };
}

async function writeSnapshot(
  admin: Admin,
  snap: { ok: boolean; errorRatePct: number | null; events24h: number | null; detail: string },
  issues: SentryIssue[],
): Promise<void> {
  try {
    await admin.from("sentry_snapshot").upsert({
      id: true,
      ok: snap.ok,
      error_rate_pct: snap.errorRatePct,
      events_24h: snap.events24h,
      detail: snap.detail,
      fetched_at: new Date().toISOString(),
    });
    // Replace the cached issues wholesale (only when we actually got some, so a
    // transient blip doesn't wipe the panel).
    if (issues.length > 0) {
      await admin.from("sentry_issues").delete().gte("id", 0);
      await admin.from("sentry_issues").insert(
        issues.map((iss) => ({
          rank: iss.rank,
          title: iss.title,
          culprit: iss.culprit,
          level: iss.level,
          events: iss.events,
          users: iss.users,
          last_seen: iss.lastSeen,
          permalink: iss.permalink,
        })),
      );
    }
  } catch (err) {
    console.error("[sentry] writeSnapshot failed", err);
  }
}

// ── reads (dashboard + alerts) ───────────────────────────────────────────────

export async function readSentrySnapshot(admin = createAdminClient()): Promise<SentrySnapshot | null> {
  const { data } = await admin
    .from("sentry_snapshot")
    .select("ok, error_rate_pct, events_24h, detail, fetched_at")
    .eq("id", true)
    .maybeSingle();
  if (!data) return null;
  return {
    ok: !!data.ok,
    errorRatePct: data.error_rate_pct != null ? Number(data.error_rate_pct) : null,
    events24h: data.events_24h != null ? Number(data.events_24h) : null,
    detail: (data.detail as string | null) ?? "",
    fetchedAt: (data.fetched_at as string | null) ?? null,
  };
}

export async function readTopIssues(admin = createAdminClient()): Promise<SentryIssue[]> {
  const { data } = await admin
    .from("sentry_issues")
    .select("rank, title, culprit, level, events, users, last_seen, permalink")
    .order("rank", { ascending: true })
    .limit(ISSUE_LIMIT);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    rank: Number(r.rank),
    title: String(r.title),
    culprit: (r.culprit as string | null) ?? null,
    level: (r.level as string | null) ?? null,
    events: r.events != null ? Number(r.events) : null,
    users: r.users != null ? Number(r.users) : null,
    lastSeen: (r.last_seen as string | null) ?? null,
    permalink: (r.permalink as string | null) ?? null,
  }));
}
