import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeEqual } from "@/lib/safe-equal";
import { runTrialEndingSweep } from "@/lib/trial-ending-emails";
import { recordCronRun } from "@/lib/platform/cron-runs";

// Courtesy-trial "ends next week" owner emails. Platform-level (no
// location_id): /api/cron/tick calls this once per UTC day. Once-per-trial by
// organizations.tenant_trial_notice_for — safe to call more often.
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !safeEqual(authHeader, `Bearer ${process.env.CRON_SECRET}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const __t0 = Date.now();

  const results = await runTrialEndingSweep(admin);

  console.log("[cron/trial-ending]", results);
  await recordCronRun(
    admin,
    "cron/trial-ending",
    results.errors.length === 0,
    Date.now() - __t0,
    `sent ${results.sent}, skipped ${results.skipped}, checked ${results.checked}` +
      (results.errors.length ? ` — ${results.errors[0]}`.slice(0, 200) : ""),
  );
  return NextResponse.json({ success: true, ...results });
}
