import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeEqual } from "@/lib/safe-equal";
import { logAudit } from "@/lib/audit";
import { recordCronRun } from "@/lib/platform/cron-runs";

export const runtime = "nodejs";
export const maxDuration = 60;

// Sweeps pending quotes that passed their expires_at and flips them to
// "expired" + audit-logs each one. Covers BOTH the DVI mid-job quotes
// (job_quotes) and the pre-job standalone quotes (standalone_quotes).

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !safeEqual(authHeader, `Bearer ${process.env.CRON_SECRET}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const __t0 = Date.now();
  const nowIso = new Date().toISOString();

  // Single sweep across the unified quotes table (both DVI job quotes and
  // standalone quotes live here now).
  type Row = { id: string; quote_type: "job" | "standalone"; job_id: string | null; organization_id: string; total: number };
  const { data: stale } = await admin
    .from("quotes")
    .select("id, quote_type, job_id, organization_id, total")
    .eq("status", "pending")
    .lt("expires_at", nowIso);
  const rows = (stale ?? []) as Row[];

  let jobExpired = 0;
  let standaloneExpired = 0;

  if (rows.length > 0) {
    const { error } = await admin
      .from("quotes")
      .update({ status: "expired" })
      .in("id", rows.map((r) => r.id))
      .eq("status", "pending");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    for (const r of rows) {
      await logAudit({
        organizationId: r.organization_id,
        action: "quote.expire",
        entityType: r.quote_type === "job" ? "job_quote" : "standalone_quote",
        entityId: r.id,
        metadata: r.quote_type === "job" ? { job_id: r.job_id, total: r.total } : { total: r.total },
      });
      if (r.quote_type === "job") jobExpired++;
      else standaloneExpired++;
    }
  }

  await recordCronRun(admin, "cron/quote-expiry", true, Date.now() - __t0, `expired ${jobExpired + standaloneExpired}`);
  return NextResponse.json({
    success: true,
    expired: jobExpired + standaloneExpired,
    job_expired: jobExpired,
    standalone_expired: standaloneExpired,
  });
}
