import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Liveness probe pinged by /api/cron/uptime for every tenant subdomain and the
// platform "web" target. Intentionally DB-free and cheap — it measures app +
// edge reachability per host, not per-tenant logic, and runs N×/cron so it must
// not touch the database.
export async function GET() {
  return NextResponse.json(
    { ok: true, ts: new Date().toISOString() },
    { headers: { "cache-control": "no-store" } },
  );
}
