import { createAdminClient } from "@/lib/supabase/admin";
import { fetchDbHealth } from "@/lib/platform/services";
import { recentWebhookFailureRate } from "@/lib/platform/webhooks";

type Admin = ReturnType<typeof createAdminClient>;

export type AlertRule = {
  id: string;
  name: string;
  metric: string;
  operator: ">" | "<" | ">=" | "<=";
  threshold: number;
  window_secs: number;
  source: string;
  severity: "SEV-1" | "SEV-2" | "SEV-3" | "SEV-4";
  auto_declare: boolean;
  channels: string[];
  enabled: boolean;
  last_fired_at: string | null;
};

export type AlertRuleView = AlertRule & { firing: boolean };

// All rules, with a derived `firing` flag (fired within its own window).
export async function fetchAlertRules(): Promise<AlertRuleView[]> {
  const admin = createAdminClient();
  const { data } = await admin.from("alert_rules").select("*").order("severity").order("name");
  const now = Date.now();
  return ((data ?? []) as AlertRule[]).map((r) => ({
    ...r,
    threshold: Number(r.threshold),
    firing: !!r.last_fired_at && now - new Date(r.last_fired_at).getTime() < r.window_secs * 1000,
  }));
}

function compare(v: number, op: string, t: number): boolean {
  return op === ">" ? v > t : op === "<" ? v < t : op === ">=" ? v >= t : v <= t;
}

type EvalSample = { ok: boolean; latency_ms: number | null };
type MetricContext = { dbPoolPct: number | null; webhook5xxRate: number | null };

// Value for a metric from the current probe run + context. Returns null for
// metrics whose data source isn't wired yet (Sentry — later PR), so those
// rules stay dormant.
function metricValue(metric: string, samples: EvalSample[], ctx: MetricContext): number | null {
  if (metric === "db_pool_pct") return ctx.dbPoolPct;
  if (metric === "webhook_5xx_rate") return ctx.webhook5xxRate;
  if (samples.length === 0) return null;
  if (metric === "availability_pct") {
    const ok = samples.filter((s) => s.ok).length;
    return (100 * ok) / samples.length;
  }
  if (metric === "p95_ms") {
    const lat = samples.map((s) => s.latency_ms ?? 0).filter((n) => n > 0).sort((a, b) => a - b);
    if (lat.length === 0) return 0;
    return lat[Math.min(lat.length - 1, Math.floor(lat.length * 0.95))];
  }
  return null;
}

// Post to the ops Slack incoming webhook. No-op unless SLACK_OPS_WEBHOOK_URL is
// set and the rule targets a Slack channel. Never throws.
export async function notifySlack(text: string, channels: string[]): Promise<void> {
  const url = process.env.SLACK_OPS_WEBHOOK_URL;
  if (!url) return;
  if (!channels.some((c) => c.toLowerCase().includes("slack"))) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch (err) {
    console.error("[alerts] slack notify failed", err);
  }
}

// Evaluate enabled rules against the current probe run. Debounces on the rule's
// window, notifies Slack, and auto-declares an incident for auto_declare rules
// (deduped by alert_rule_id). Returns the number of incidents opened. Never
// throws — alerting must not break the probe cron.
export async function evaluateAlerts(admin: Admin, samples: EvalSample[]): Promise<number> {
  try {
    const { data: rules } = await admin.from("alert_rules").select("*").eq("enabled", true);
    if (!rules?.length) return 0;

    // Context for non-synthetic metrics computable now (DB pool, webhook 5xx).
    const [db, webhook5xxRate] = await Promise.all([
      fetchDbHealth(admin),
      recentWebhookFailureRate(admin, 300),
    ]);
    const ctx: MetricContext = { dbPoolPct: db?.pct ?? null, webhook5xxRate };

    const now = Date.now();
    let opened = 0;

    for (const rule of rules as AlertRule[]) {
      const value = metricValue(rule.metric, samples, ctx);
      if (value == null) continue; // metric not wired yet
      if (!compare(value, rule.operator, Number(rule.threshold))) continue;

      // Debounce: don't re-fire within the rule's window.
      if (rule.last_fired_at && now - new Date(rule.last_fired_at).getTime() < rule.window_secs * 1000) continue;
      await admin.from("alert_rules").update({ last_fired_at: new Date(now).toISOString() }).eq("id", rule.id);

      await notifySlack(
        `🚨 ${rule.severity} · ${rule.name} — ${rule.metric} ${rule.operator} ${rule.threshold} (observed ${Math.round(value * 100) / 100})`,
        rule.channels ?? [],
      );

      if (rule.auto_declare) {
        const { data: existing } = await admin
          .from("incidents")
          .select("id")
          .eq("alert_rule_id", rule.id)
          .is("resolved_at", null)
          .maybeSingle();
        if (existing) continue;

        const ref = "INC-" + now.toString().slice(-5);
        const { data: inc } = await admin
          .from("incidents")
          .insert({
            ref,
            title: rule.name,
            severity: rule.severity,
            status: "Investigating",
            components: [],
            auto_declared: true,
            alert_rule_id: rule.id,
          })
          .select("id")
          .single();
        if (inc) {
          await admin.from("incident_updates").insert({
            incident_id: inc.id,
            status: "Investigating",
            body: `Auto-declared: ${rule.metric} ${rule.operator} ${rule.threshold} (observed ${Math.round(value * 100) / 100}).`,
            actor_email: "system@ai-garage.co.uk",
            public: false,
          });
          opened++;
        }
      }
    }
    return opened;
  } catch (err) {
    console.error("[alerts] evaluateAlerts failed", err);
    return 0;
  }
}
