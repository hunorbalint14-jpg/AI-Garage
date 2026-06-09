import { createAdminClient } from "@/lib/supabase/admin";

// Live events tail for /admin/health (PR 5e). Merges the recent rows we already
// log across the platform into one reverse-chronological feed: cron runs,
// inbound webhook deliveries, incident updates, and alert fires. Read-only over
// the service-role client — no new table, just a union of existing stores.

export type EventSeverity = "success" | "info" | "warn" | "error";
export type EventSource = "cron" | "webhook" | "incident" | "alert";

export type PlatformEvent = {
  id: string;
  at: string; // ISO
  severity: EventSeverity;
  source: EventSource;
  message: string;
  tenant: string | null;
};

const WINDOW_HOURS = 24;

function fmtDuration(ms: number | null): string {
  if (ms == null) return "";
  return ms < 1000 ? ` (${ms}ms)` : ` (${(ms / 1000).toFixed(1)}s)`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

// SEV-1/2 → error, SEV-3 → warn, else info; a Resolved update reads as success.
function severityFor(sev: string | null, status?: string): EventSeverity {
  if (status === "Resolved") return "success";
  if (sev === "SEV-1" || sev === "SEV-2") return "error";
  if (sev === "SEV-3") return "warn";
  return "info";
}

export async function fetchEventFeed(limit = 40): Promise<PlatformEvent[]> {
  const admin = createAdminClient();
  const since = new Date(Date.now() - WINDOW_HOURS * 3_600_000).toISOString();
  const events: PlatformEvent[] = [];

  const [cron, webhooks, updates, alerts] = await Promise.all([
    admin
      .from("cron_runs")
      .select("id, job, ok, duration_ms, detail, ran_at")
      .gte("ran_at", since)
      .order("ran_at", { ascending: false })
      .limit(limit),
    admin
      .from("webhook_deliveries")
      .select("id, provider, event_type, ok, status_code, received_at")
      .gte("received_at", since)
      .order("received_at", { ascending: false })
      .limit(limit),
    admin
      .from("incident_updates")
      .select("id, status, body, created_at, incident:incidents(ref, severity)")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(limit),
    admin
      .from("alert_rules")
      .select("id, name, metric, operator, threshold, severity, last_fired_at")
      .gte("last_fired_at", since)
      .order("last_fired_at", { ascending: false })
      .limit(limit),
  ]);

  for (const r of (cron.data ?? []) as { id: number; job: string; ok: boolean; duration_ms: number | null; detail: string | null; ran_at: string }[]) {
    events.push({
      id: `cron-${r.id}`,
      at: r.ran_at,
      severity: r.ok ? "success" : "error",
      source: "cron",
      message: `${r.job} ${r.ok ? "completed" : "failed"}${r.detail ? ` — ${r.detail}` : ""}${fmtDuration(r.duration_ms)}`,
      tenant: null,
    });
  }

  for (const r of (webhooks.data ?? []) as { id: number; provider: string; event_type: string | null; ok: boolean; status_code: number | null; received_at: string }[]) {
    events.push({
      id: `wh-${r.id}`,
      at: r.received_at,
      severity: r.ok ? "success" : "error",
      source: "webhook",
      message: `${r.provider}${r.event_type ? ` ${r.event_type}` : ""} ${r.ok ? "delivered" : "failed"}${r.status_code ? ` (${r.status_code})` : ""}`,
      tenant: null,
    });
  }

  type IncRef = { ref: string; severity: string };
  for (const r of (updates.data ?? []) as unknown as { id: number; status: string; body: string; created_at: string; incident: IncRef | IncRef[] | null }[]) {
    // PostgREST may return the to-one embed as an object or a single-element array.
    const inc = Array.isArray(r.incident) ? r.incident[0] ?? null : r.incident;
    events.push({
      id: `inc-${r.id}`,
      at: r.created_at,
      severity: severityFor(inc?.severity ?? null, r.status),
      source: "incident",
      message: `${inc?.ref ? `${inc.ref} ` : ""}${r.status} — ${truncate(r.body, 120)}`,
      tenant: null,
    });
  }

  for (const r of (alerts.data ?? []) as { id: string; name: string; metric: string; operator: string; threshold: number; severity: string; last_fired_at: string }[]) {
    events.push({
      id: `alert-${r.id}-${r.last_fired_at}`,
      at: r.last_fired_at,
      severity: severityFor(r.severity),
      source: "alert",
      message: `${r.name} fired · ${r.metric} ${r.operator} ${r.threshold}`,
      tenant: null,
    });
  }

  events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return events.slice(0, limit);
}
