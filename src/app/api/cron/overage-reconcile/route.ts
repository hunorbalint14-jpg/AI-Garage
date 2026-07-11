import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeEqual } from "@/lib/safe-equal";
import { stripe } from "@/lib/stripe";
import { syncLocationOverage, OVERAGE_PRICE_ENV } from "@/lib/tenant-overage";
import { recordCronRun } from "@/lib/platform/cron-runs";

// Growth overage reconcile (#461): keeps every Growth subscription's
// per-location quantity equal to the real location count, so a missed
// webhook or a failed inline sync can't drift the bill. Platform-level;
// called by /api/cron/tick once per UTC day. Idempotent.
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !safeEqual(authHeader, `Bearer ${process.env.CRON_SECRET}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env[OVERAGE_PRICE_ENV]) {
    return NextResponse.json({ success: true, skipped: "no_price_configured" });
  }

  const admin = createAdminClient();
  const __t0 = Date.now();
  const { data } = await admin
    .from("organizations")
    .select("id, slug")
    .eq("tenant_plan", "growth")
    .not("tenant_stripe_subscription_id", "is", null)
    .limit(200);

  const results = { checked: 0, synced: 0, errors: [] as string[] };
  for (const org of (data ?? []) as { id: string; slug: string }[]) {
    results.checked++;
    const res = await syncLocationOverage(admin, stripe, org.id);
    if (res.status === "synced") results.synced++;
    else if (res.status === "error") results.errors.push(`${org.slug}: ${res.message}`);
  }

  console.log("[cron/overage-reconcile]", results);
  await recordCronRun(
    admin,
    "cron/overage-reconcile",
    results.errors.length === 0,
    Date.now() - __t0,
    `checked ${results.checked}, synced ${results.synced}`,
  );
  return NextResponse.json({ success: true, ...results });
}
