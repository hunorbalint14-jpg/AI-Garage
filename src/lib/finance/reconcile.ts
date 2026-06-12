import type { createAdminClient } from "@/lib/supabase/admin";
import { getActiveFinanceConfig, toBumperConfig, normalizeBumperStatus } from "./index";
import { bumperStatus } from "./bumper";
import { logAudit } from "@/lib/audit";

// Bumper documents no webhook — polling GET /v2/status/ is the safety net
// for customers who finish the hosted checkout later or close the tab before
// returning. Runs inside the hourly /api/cron/tick (same pattern as
// runUptimeMaintenance). Only looks at applications older than 10 minutes so
// it never races the customer's own return redirect.

const MAX_PER_RUN = 50;

export async function reconcileFinanceApplications(
  admin: ReturnType<typeof createAdminClient>,
): Promise<{ checked: number; updated: number }> {
  const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data } = await admin
    .from("finance_applications")
    .select("token, organization_id, status, quote_slug")
    .in("status", ["pending", "in_progress"])
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(MAX_PER_RUN);

  type Row = { token: string; organization_id: string; status: string; quote_slug: string };
  const rows = (data ?? []) as Row[];
  if (rows.length === 0) return { checked: 0, updated: 0 };

  // One config load per org, not per application.
  const configByOrg = new Map<string, Awaited<ReturnType<typeof getActiveFinanceConfig>>>();
  let updated = 0;

  for (const row of rows) {
    let config = configByOrg.get(row.organization_id);
    if (config === undefined) {
      config = await getActiveFinanceConfig(row.organization_id);
      configByOrg.set(row.organization_id, config);
    }
    if (!config) continue; // provider disabled since the application was raised

    try {
      const status = await bumperStatus(row.token, toBumperConfig(config));
      const normalized = normalizeBumperStatus(status.status);
      if (normalized === row.status) continue;

      await admin
        .from("finance_applications")
        .update({ status: normalized, raw_last_status: status, updated_at: new Date().toISOString() })
        .eq("token", row.token);
      updated++;

      if (normalized === "completed") {
        await logAudit({
          organizationId: row.organization_id,
          action: "finance.application_completed",
          entityType: "finance_application",
          entityId: row.token,
          metadata: { quote_slug: row.quote_slug, via: "reconcile" },
        });
      }
    } catch (err) {
      console.error("[finance] reconcile failed", { token: row.token.slice(0, 8), err });
    }
  }

  return { checked: rows.length, updated };
}
