import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const maxDuration = 60;

// Sweeps pending quotes that passed their expires_at and flips them to
// "expired" + audit-logs each one. Covers BOTH the DVI mid-job quotes
// (job_quotes) and the pre-job standalone quotes (standalone_quotes).

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  let jobExpired = 0;
  let standaloneExpired = 0;

  // --- DVI mid-job quotes --------------------------------------------------
  type JobRow = { id: string; job_id: string; location_id: string; total: number };
  const { data: staleJob } = await admin
    .from("job_quotes")
    .select("id, job_id, location_id, total")
    .eq("status", "pending")
    .lt("expires_at", nowIso);
  const jobRows = (staleJob ?? []) as JobRow[];

  if (jobRows.length > 0) {
    const ids = jobRows.map((r) => r.id);
    const { error } = await admin
      .from("job_quotes")
      .update({ status: "expired" })
      .in("id", ids)
      .eq("status", "pending");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    for (const r of jobRows) {
      await logAudit({
        action: "quote.expire",
        entityType: "job_quote",
        entityId: r.id,
        metadata: { job_id: r.job_id, total: r.total },
      });
    }
    jobExpired = jobRows.length;
  }

  // --- Standalone quotes ---------------------------------------------------
  type StandaloneRow = { id: string; organization_id: string; total: number };
  const { data: staleStandalone } = await admin
    .from("standalone_quotes")
    .select("id, organization_id, total")
    .eq("status", "pending")
    .lt("expires_at", nowIso);
  const standaloneRows = (staleStandalone ?? []) as StandaloneRow[];

  if (standaloneRows.length > 0) {
    const ids = standaloneRows.map((r) => r.id);
    const { error } = await admin
      .from("standalone_quotes")
      .update({ status: "expired" })
      .in("id", ids)
      .eq("status", "pending");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    for (const r of standaloneRows) {
      await logAudit({
        organizationId: r.organization_id,
        action: "standalone_quote.expire",
        entityType: "standalone_quote",
        entityId: r.id,
        metadata: { total: r.total },
      });
    }
    standaloneExpired = standaloneRows.length;
  }

  return NextResponse.json({
    success: true,
    expired: jobExpired + standaloneExpired,
    job_expired: jobExpired,
    standalone_expired: standaloneExpired,
  });
}
