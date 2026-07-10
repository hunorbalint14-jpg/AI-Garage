import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeEqual } from "@/lib/safe-equal";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { runActivationSweep } from "@/lib/activation-emails";
import { recordCronRun } from "@/lib/platform/cron-runs";

// First-week activation emails (#506 PR 4). Platform-level (no location_id):
// /api/cron/tick calls this once per UTC day. Stage-idempotent — safe to call
// more often.
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !safeEqual(authHeader, `Bearer ${process.env.CRON_SECRET}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!(await isFeatureEnabled("activation_emails"))) {
    return NextResponse.json({ success: true, skipped: "flag_off" });
  }

  const admin = createAdminClient();
  const __t0 = Date.now();
  const results = await runActivationSweep(admin);

  console.log("[cron/activation]", results);
  await recordCronRun(
    admin,
    "cron/activation",
    results.errors.length === 0,
    Date.now() - __t0,
    `sent ${results.sent}, stopped ${results.stopped}, checked ${results.checked}`,
  );
  return NextResponse.json({ success: true, ...results });
}
