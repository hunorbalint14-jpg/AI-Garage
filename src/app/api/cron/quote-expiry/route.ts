import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const maxDuration = 60;

// Sweeps pending quotes that passed their expires_at and flips them to
// "expired" + audit-logs each one. Triggered from /api/cron/tick.

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  const { data: stale } = await admin
    .from("job_quotes")
    .select("id, job_id, location_id, total")
    .eq("status", "pending")
    .lt("expires_at", nowIso);

  type Row = { id: string; job_id: string; location_id: string; total: number };
  const rows = (stale ?? []) as Row[];

  if (rows.length === 0) {
    return NextResponse.json({ success: true, expired: 0 });
  }

  const ids = rows.map((r) => r.id);
  const { error } = await admin
    .from("job_quotes")
    .update({ status: "expired" })
    .in("id", ids)
    .eq("status", "pending");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  for (const r of rows) {
    await logAudit({
      action: "quote.expire",
      entityType: "job_quote",
      entityId: r.id,
      metadata: { job_id: r.job_id, total: r.total },
    });
  }

  return NextResponse.json({ success: true, expired: rows.length });
}
