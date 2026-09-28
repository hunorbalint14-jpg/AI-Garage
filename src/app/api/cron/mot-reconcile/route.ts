import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeEqual } from "@/lib/safe-equal";
import { recordCronRun } from "@/lib/platform/cron-runs";
import { reconcileStaleMotExpiries } from "@/lib/mot-reconcile";

export const runtime = "nodejs";
export const maxDuration = 60;

// Nightly MOT reconcile — re-checks, per registration, vehicles whose stored
// MOT expiry has passed or is about to, which the delta sync (cron/mot-delta)
// cannot correct. Runs after the delta so it only picks up what's still stale.
// See src/lib/mot-reconcile.ts.

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !safeEqual(authHeader, `Bearer ${process.env.CRON_SECRET}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const t0 = Date.now();

  let result;
  try {
    result = await reconcileStaleMotExpiries(admin);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordCronRun(admin, "cron/mot-reconcile", false, Date.now() - t0, message.slice(0, 200));
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const detail =
    `checked ${result.checked}/${result.candidates}, updated ${result.updated}, ` +
    `elsewhere ${result.elsewhere}, not found ${result.notFound}, errors ${result.errors}` +
    (result.stoppedEarly ? `, stopped: ${result.stoppedEarly.slice(0, 100)}` : "") +
    (result.testsError ? `, tests error: ${result.testsError.slice(0, 60)}` : "");
  // A systemic stop (missing key, auth, quota) records as a FAILED run so
  // /admin/health surfaces it, instead of a green run that checked nothing.
  await recordCronRun(admin, "cron/mot-reconcile", !result.failed, Date.now() - t0, detail);

  return NextResponse.json({ success: !result.failed, ...result }, { status: result.failed ? 502 : 200 });
}
