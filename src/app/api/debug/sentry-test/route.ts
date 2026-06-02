import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// TEMPORARY — Sentry smoke test. GET /api/debug/sentry-test captures an error
// explicitly, flushes before the serverless function suspends, and reports
// whether the server DSN is even present. The JSON response tells us which side
// is broken without guessing:
//   hasServerDsn=false → SENTRY_DSN missing in this env (capture is a no-op)
//   hasServerDsn=true + eventId set + still not in Sentry → wrong DSN / project / network
// Delete this route + close the PR (no merge) once capture is confirmed.
export async function GET() {
  const hasServerDsn = !!process.env.SENTRY_DSN;

  const eventId = Sentry.captureException(
    new Error("Sentry smoke test — manual server error"),
  );
  const flushed = await Sentry.flush(2000);

  return NextResponse.json({
    ok: true,
    hasServerDsn,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? null,
    eventId: eventId ?? null,
    flushed,
  });
}
