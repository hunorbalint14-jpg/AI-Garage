import { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

const RAW_RETENTION_DAYS = 7;

// Hourly maintenance for the reliability store, run from /api/cron/tick:
//   - roll raw uptime_checks into the hourly uptime_rollup (previous + current
//     hour, idempotent upsert), so trend queries hit the small rollup table;
//   - drop raw uptime samples + webhook delivery rows older than the window.
// Never throws — a failure here must not break the hourly orchestrator.
export async function runUptimeMaintenance(admin: Admin): Promise<void> {
  try {
    const cur = new Date();
    cur.setMinutes(0, 0, 0);
    const prev = new Date(cur.getTime() - 3_600_000);

    await admin.rpc("rollup_uptime_hour", { p_bucket: prev.toISOString() });
    await admin.rpc("rollup_uptime_hour", { p_bucket: cur.toISOString() });

    const cutoff = new Date(Date.now() - RAW_RETENTION_DAYS * 24 * 3_600_000).toISOString();
    await admin.from("uptime_checks").delete().lt("checked_at", cutoff);
    await admin.from("webhook_deliveries").delete().lt("received_at", cutoff);
    await admin.from("cron_runs").delete().lt("ran_at", cutoff);
  } catch (err) {
    console.error("[uptime-maintenance] failed", err);
  }
}
