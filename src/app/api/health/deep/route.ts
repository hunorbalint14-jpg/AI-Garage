import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Deep liveness probe pinged per tenant by /api/cron/uptime. Unlike /api/health
// (deliberately DB-free), this measures the REAL backend cost: one indexed
// tenant-resolution query — the same lookup every tenant request makes. Reports
// db_ms (server-side query time) and total_ms (handler time); the cron also sees
// the end-to-end time incl. network/TLS. No auth: it measures stack latency, not
// per-tenant data, so the service-role client is intentional.
export async function GET(request: NextRequest) {
  const t0 = performance.now();
  const slug = request.headers.get("x-tenant-slug");
  const admin = createAdminClient();

  const tDb = performance.now();
  // Tenant host → resolve the org by slug (the canonical per-request lookup).
  // Platform host (no slug) → a minimal indexed read to time the DB round-trip.
  const query = slug
    ? admin.from("organizations").select("id").eq("slug", slug).maybeSingle()
    : admin.from("organizations").select("id").limit(1);
  const { error } = await query;
  const dbMs = Math.round(performance.now() - tDb);

  const totalMs = Math.round(performance.now() - t0);
  const ok = !error;
  return NextResponse.json(
    { ok, db_ms: dbMs, total_ms: totalMs, error: error?.message ?? null },
    {
      status: ok ? 200 : 503,
      headers: {
        "cache-control": "no-store",
        "Server-Timing": `db;dur=${dbMs};desc="db", total;dur=${totalMs}`,
      },
    },
  );
}
