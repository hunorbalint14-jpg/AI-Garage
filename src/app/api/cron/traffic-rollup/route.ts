import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeEqual } from "@/lib/safe-equal";
import { recordCronRun } from "@/lib/platform/cron-runs";

// Traffic rollup + retention (#admin/traffic PR 1). Platform-level:
// /api/cron/tick calls this once per UTC day. Two idempotent passes:
//   1. rollup_page_views(day) for the last 3 completed UTC days — delete-then-
//      insert per day, so re-runs absorb late-arriving beacons harmlessly;
//   2. purge raw page_views older than 90 days (rollups are kept forever).
export const runtime = "nodejs";
export const maxDuration = 60;

const ROLLUP_DAYS = 3;
const RAW_RETENTION_DAYS = 90;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !safeEqual(authHeader, `Bearer ${process.env.CRON_SECRET}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const __t0 = Date.now();
  const errors: string[] = [];
  let rolled = 0;

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let back = 1; back <= ROLLUP_DAYS; back++) {
    const day = new Date(today.getTime() - back * 86_400_000).toISOString().slice(0, 10);
    const { error } = await admin.rpc("rollup_page_views", { p_day: day });
    if (error) errors.push(`rollup ${day}: ${error.message}`);
    else rolled++;
  }

  const cutoff = new Date(Date.now() - RAW_RETENTION_DAYS * 86_400_000).toISOString();
  const { error: purgeError } = await admin.from("page_views").delete().lt("occurred_at", cutoff);
  if (purgeError) errors.push(`purge: ${purgeError.message}`);

  const results = { rolled, errors };
  console.log("[cron/traffic-rollup]", results);
  await recordCronRun(
    admin,
    "cron/traffic-rollup",
    errors.length === 0,
    Date.now() - __t0,
    `rolled ${rolled}/${ROLLUP_DAYS}${errors.length ? `, ${errors.length} errors` : ""}`,
  );
  return NextResponse.json({ success: errors.length === 0, ...results });
}
