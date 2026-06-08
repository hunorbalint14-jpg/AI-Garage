import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Auth/DB reachability probe — pinged once per uptime-cron run as the platform
// "auth" target (not per tenant, so a real Supabase round-trip here is fine). A
// cheap admin auth call confirms the Supabase Auth + service-role path is live.
export async function GET() {
  try {
    const admin = createAdminClient();
    const { error } = await admin.auth.admin.listUsers({ perPage: 1 });
    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 503, headers: { "cache-control": "no-store" } },
      );
    }
    return NextResponse.json({ ok: true, ts: new Date().toISOString() }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
