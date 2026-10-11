import { createAdminClient } from "@/lib/supabase/admin";
import { fetchDbHealth } from "@/lib/platform/services";
import { fetchStaleCronJobs, type StaleCron } from "@/lib/platform/cron-runs";
import { recentWebhookFailureRate } from "@/lib/platform/webhooks";
import { readSentrySnapshot } from "@/lib/platform/sentry";
import { sendEmailBatch } from "@/lib/email";
import { redis } from "@/lib/redis";

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
  /** How the last firing was delivered: "slack" | "email" | "none" (#450). */
  last_delivery: string | null;
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

// Human-readable but collision-proof: the clock alone repeats within a single
// evaluation run, and `incidents.ref` is UNIQUE.
export function incidentRef(nowMs: number = Date.now()): string {
  const suffix = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `INC-${nowMs.toString().slice(-5)}-${suffix}`;
}

function compare(v: number, op: string, t: number): boolean {
  return op === ">" ? v > t : op === "<" ? v < t : op === ">=" ? v >= t : v <= t;
}

// ── Confirmation (debounce) ─────────────────────────────────────────────────
//
// Synthetic metrics are scored on ONE probe run — six probes, or two when the
// tenant lookup itself fails. A single blip (a second of Supabase slowness on
// 29 Sep 2026: one 503 plus a failed tenant lookup) read as 50% availability
// and paged a SEV-2. They now have to breach on consecutive runs before
// anything fires. The streak lives in Redis, not Postgres: a database blip is
// exactly when Postgres can't be asked what the last run looked like. When
// neither can answer, the alert fires — never stay silent through an outage.

/** Consecutive breaching runs a metric needs before its rule fires. */
export function confirmationsRequired(metric: string): number {
  return metric === "availability_pct" || metric === "p95_ms" ? 2 : 1;
}

/**
 * Whether a breach is confirmed. `streak` = consecutive breaching runs
 * including this one (null = streak store unavailable); `previousRunBreached`
 * = the fallback read of the last run from uptime_checks (null = unknown too).
 * Unknown on both counts fails OPEN.
 */
export function isConfirmed(required: number, streak: number | null, previousRunBreached: boolean | null): boolean {
  if (required <= 1) return true;
  if (streak !== null) return streak >= required;
  if (previousRunBreached !== null) return previousRunBreached;
  return true;
}

/**
 * Auto-declared incidents resolve once the rule has been clear for a full
 * window since it last fired. The window doubles as hysteresis, so a flapping
 * metric doesn't resolve and re-declare every run.
 */
export function clearedLongEnough(rule: Pick<AlertRule, "last_fired_at" | "window_secs">, now: number): boolean {
  if (!rule.last_fired_at) return true;
  return now - new Date(rule.last_fired_at).getTime() >= rule.window_secs * 1000;
}

type EvalSource = "uptime" | "golden-path";

/** Streak TTL: a few probe intervals, so a skipped run breaks the streak. */
const STREAK_TTL_SEC = 15 * 60;
const streakKey = (ruleId: string, source: EvalSource) => `alert:streak:${source}:${ruleId}`;

/** Record this run's outcome; returns the streak, or null if Redis can't answer. */
async function updateStreak(ruleId: string, source: EvalSource, breached: boolean): Promise<number | null> {
  if (!redis) return null;
  try {
    const key = streakKey(ruleId, source);
    if (!breached) {
      await redis.del(key);
      return 0;
    }
    const n = await redis.incr(key);
    await redis.expire(key, STREAK_TTL_SEC);
    return n;
  } catch (err) {
    console.error("[alerts] streak store unavailable", { ruleId, err });
    return null;
  }
}

/**
 * Fallback when Redis can't answer: did the previous uptime run (the latest
 * batch of uptime_checks older than this run) breach the same rule? Null when
 * that can't be read either.
 */
async function previousRunBreached(admin: Admin, rule: AlertRule, now: number): Promise<boolean | null> {
  try {
    const { data, error } = await admin
      .from("uptime_checks")
      .select("ok, latency_ms, checked_at")
      .lt("checked_at", new Date(now - 60_000).toISOString())
      .gte("checked_at", new Date(now - 10 * 60_000).toISOString())
      .order("checked_at", { ascending: false })
      .limit(200);
    if (error || !data?.length) return null;
    const rows = data as { ok: boolean; latency_ms: number | null; checked_at: string }[];
    const latest = rows[0].checked_at;
    const lastRun = rows.filter((r) => r.checked_at === latest);
    const value = metricValue(rule.metric, lastRun, EMPTY_CONTEXT);
    return value == null ? null : compare(value, rule.operator, Number(rule.threshold));
  } catch {
    return null;
  }
}

/**
 * Resolve the open, unpublished, auto-declared incident for a rule that has
 * cleared. Published incidents are on the public status page, so a human
 * closes those. Returns 1 when one was resolved.
 */
async function autoResolveIncident(admin: Admin, rule: AlertRule, value: number, now: number): Promise<number> {
  const { data: open } = await admin
    .from("incidents")
    .select("id, ref")
    .eq("alert_rule_id", rule.id)
    .eq("auto_declared", true)
    .eq("published", false)
    .is("resolved_at", null)
    .maybeSingle();
  const inc = open as { id: string; ref: string } | null;
  if (!inc) return 0;

  const observed = Math.round(value * 100) / 100;
  const { error } = await admin
    .from("incidents")
    .update({ status: "Resolved", resolved_at: new Date(now).toISOString() })
    .eq("id", inc.id)
    .is("resolved_at", null);
  if (error) {
    console.error("[alerts] auto-resolve failed", { rule: rule.id, error: error.message });
    return 0;
  }
  await admin.from("incident_updates").insert({
    incident_id: inc.id,
    status: "Resolved",
    body: `Auto-resolved: ${rule.metric} back within threshold (observed ${observed}) for a full ${rule.window_secs}s window.`,
    actor_email: "system@ai-garage.co.uk",
    public: false,
  });
  await deliverAlert({
    subject: `[RESOLVED] ${rule.name}`,
    text: `✅ Resolved · ${rule.name} — ${rule.metric} back within threshold (observed ${observed}).\n\nIncident: ${inc.ref} (auto-resolved)\nRule: ${rule.id}`,
    channels: rule.channels ?? [],
  });
  return 1;
}

type EvalSample = { ok: boolean; latency_ms: number | null };
type MetricContext = {
  dbPoolPct: number | null;
  webhook5xxRate: number | null;
  errorRatePct: number | null;
  /** Worst overdue minutes across the watched crons, plus which ones (#450). */
  cronStale: { worstOverdueMins: number; jobs: string[] } | null;
};
const EMPTY_CONTEXT: MetricContext = { dbPoolPct: null, webhook5xxRate: null, errorRatePct: null, cronStale: null };

// Value for a metric from the current probe run + context. Returns null for
// metrics whose data source isn't available (e.g. Sentry transaction failure
// rate when tracing is off), so those rules stay dormant.
function metricValue(metric: string, samples: EvalSample[], ctx: MetricContext): number | null {
  if (metric === "db_pool_pct") return ctx.dbPoolPct;
  if (metric === "webhook_5xx_rate") return ctx.webhook5xxRate;
  if (metric === "error_rate_pct") return ctx.errorRatePct;
  // 0 = every watched cron ran on time, so a `> 0` rule fires the moment one
  // stops. Null only when the check itself couldn't run.
  if (metric === "cron_stale_mins") return ctx.cronStale?.worstOverdueMins ?? null;
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
export async function notifySlack(text: string, channels: string[]): Promise<boolean> {
  const url = process.env.SLACK_OPS_WEBHOOK_URL;
  if (!url) return false;
  if (!channels.some((c) => c.toLowerCase().includes("slack"))) return false;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    return res.ok;
  } catch (err) {
    console.error("[alerts] slack notify failed", err);
    return false;
  }
}

// Who ops mail goes to: the support inbox plus any platform-admin addresses.
// Deduped, so one person listed twice gets one email.
export function opsRecipients(): string[] {
  const raw = [process.env.PLATFORM_SUPPORT_EMAIL ?? "", process.env.PLATFORM_ADMIN_EMAILS ?? ""].join(",");
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const email = part.trim().toLowerCase();
    if (email.includes("@")) seen.add(email);
  }
  return [...seen];
}

// Email the ops recipients. Never throws.
export async function notifyEmail(subject: string, body: string): Promise<boolean> {
  const to = opsRecipients();
  if (to.length === 0) return false;
  try {
    const results = await sendEmailBatch(
      to.map((address) => ({ to: address, subject, text: body })),
    );
    return results.some((r) => r.success);
  } catch (err) {
    console.error("[alerts] email notify failed", err);
    return false;
  }
}

export type AlertDelivery = { slack: boolean; email: boolean; delivered: boolean };

/**
 * Get an alert in front of a human (#450).
 *
 * Slack is tried when the rule targets it, and email is sent when the rule
 * targets it — but email is ALSO the floor: if nothing else delivered, it goes
 * out regardless of what the rule's channels say. A rule configured for a Slack
 * webhook nobody set up would otherwise fire into the void, which is the exact
 * failure this exists to prevent.
 *
 * Never throws. Returns what actually delivered so the caller can record it and
 * the admin panel can show whether alerting is really wired up.
 */
export async function deliverAlert(opts: {
  subject: string;
  text: string;
  channels: string[];
}): Promise<AlertDelivery> {
  const slack = await notifySlack(opts.text, opts.channels);

  const wantsEmail = opts.channels.some((c) => /e-?mail/i.test(c));
  let email = false;
  if (wantsEmail || !slack) {
    email = await notifyEmail(opts.subject, opts.text);
  }

  const delivered = slack || email;
  if (!delivered) {
    // Loud on purpose: this line in the logs is the only trace that something
    // fired and reached nobody.
    console.error("[alerts] NOT DELIVERED — no ops channel is configured", {
      subject: opts.subject,
      channels: opts.channels,
      hint: "set SLACK_OPS_WEBHOOK_URL or PLATFORM_SUPPORT_EMAIL / PLATFORM_ADMIN_EMAILS",
    });
  }
  return { slack, email, delivered };
}

// Evaluate enabled rules against the current probe run. Synthetic metrics must
// breach on consecutive runs (confirmationsRequired), then the rule debounces
// on its window, notifies, and auto-declares an incident for auto_declare rules
// (deduped by alert_rule_id). A rule that has cleared for a full window
// auto-resolves its unpublished auto-declared incident — only on the uptime
// run, which probes every target; golden-path's handful of samples can't speak
// for the whole platform. Never throws — alerting must not break the probe cron.
export async function evaluateAlerts(
  admin: Admin,
  samples: EvalSample[],
  opts: { source?: EvalSource } = {},
): Promise<{ opened: number; resolved: number }> {
  const source: EvalSource = opts.source ?? "uptime";
  try {
    const { data: rules } = await admin.from("alert_rules").select("*").eq("enabled", true);
    if (!rules?.length) return { opened: 0, resolved: 0 };

    // Context for non-synthetic metrics (DB pool, webhook 5xx, Sentry error
    // rate). The Sentry value comes from the cache the uptime cron just wrote.
    const [db, webhook5xxRate, sentry, staleCrons] = await Promise.all([
      fetchDbHealth(admin),
      recentWebhookFailureRate(admin, 300),
      readSentrySnapshot(admin),
      fetchStaleCronJobs().catch(() => [] as StaleCron[]),
    ]);
    const ctx: MetricContext = {
      dbPoolPct: db?.pct ?? null,
      webhook5xxRate,
      errorRatePct: sentry?.errorRatePct ?? null,
      cronStale: {
        worstOverdueMins: staleCrons[0]?.overdueMins ?? 0,
        jobs: staleCrons.map((c) => `${c.job} (${c.ageMins}m ago, allowed ${c.maxMins}m)`),
      },
    };

    const now = Date.now();
    let opened = 0;
    let resolved = 0;

    for (const rule of rules as AlertRule[]) {
      const value = metricValue(rule.metric, samples, ctx);
      if (value == null) continue; // metric not wired yet
      const breached = compare(value, rule.operator, Number(rule.threshold));
      const required = confirmationsRequired(rule.metric);

      if (!breached) {
        if (required > 1) await updateStreak(rule.id, source, false);
        if (rule.auto_declare && source === "uptime" && clearedLongEnough(rule, now)) {
          resolved += await autoResolveIncident(admin, rule, value, now);
        }
        continue;
      }

      // Confirmation: one bad run is a blip, two in a row is an incident.
      let confirmedNote = "";
      if (required > 1) {
        const streak = await updateStreak(rule.id, source, true);
        const prev = streak === null ? await previousRunBreached(admin, rule, now) : null;
        if (!isConfirmed(required, streak, prev)) continue;
        confirmedNote = streak !== null ? ` — ${streak} consecutive runs` : prev ? " — confirmed on the previous run" : "";
      }

      // Debounce: don't re-fire within the rule's window.
      if (rule.last_fired_at && now - new Date(rule.last_fired_at).getTime() < rule.window_secs * 1000) continue;
      await admin.from("alert_rules").update({ last_fired_at: new Date(now).toISOString() }).eq("id", rule.id);

      // A "some cron is dead" alert is useless without saying which.
      const detail =
        rule.metric === "cron_stale_mins" && ctx.cronStale?.jobs.length
          ? `\n\nNot running: ${ctx.cronStale.jobs.join(", ")}`
          : "";
      const line = `🚨 ${rule.severity} · ${rule.name} — ${rule.metric} ${rule.operator} ${rule.threshold} (observed ${Math.round(value * 100) / 100}${confirmedNote})${detail}`;
      const delivery = await deliverAlert({
        subject: `[${rule.severity}] ${rule.name}`,
        text: `${line}\n\nRule: ${rule.id}\nSource: ${rule.source}\nWindow: ${rule.window_secs}s\n\nEscalation: docs/ops-escalation.md`,
        channels: rule.channels ?? [],
      });
      await admin
        .from("alert_rules")
        .update({ last_delivery: delivery.delivered ? (delivery.slack ? "slack" : "email") : "none" })
        .eq("id", rule.id);

      if (rule.auto_declare) {
        const { data: existing } = await admin
          .from("incidents")
          .select("id")
          .eq("alert_rule_id", rule.id)
          .is("resolved_at", null)
          .maybeSingle();
        if (existing) continue;

        // `incidents.ref` is UNIQUE and used to be derived from the clock
        // alone — so two rules firing in the SAME evaluation produced the same
        // ref and the second insert was rejected, silently leaving that alert
        // with no incident. A dead scheduler trips several rules at once, which
        // is exactly when this matters, so the ref carries a per-incident
        // suffix and a failed insert is logged rather than swallowed.
        const { data: inc, error: incErr } = await admin
          .from("incidents")
          .insert({
            ref: incidentRef(now),
            title: rule.name,
            severity: rule.severity,
            status: "Investigating",
            components: [],
            auto_declared: true,
            alert_rule_id: rule.id,
          })
          .select("id")
          .single();
        if (incErr) {
          console.error("[alerts] incident insert failed", { rule: rule.id, error: incErr.message });
        }
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
    return { opened, resolved };
  } catch (err) {
    console.error("[alerts] evaluateAlerts failed", err);
    return { opened: 0, resolved: 0 };
  }
}
