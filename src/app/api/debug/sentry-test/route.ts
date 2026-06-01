import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// TEMPORARY — Sentry smoke test. Hitting GET /api/debug/sentry-test calls an
// undefined function, throwing a ReferenceError so we can confirm that server
// errors reach Sentry (forwarded by onRequestError in src/instrumentation.ts).
// Test on a preview deployment, confirm the issue appears in Sentry, then DELETE
// this route (close the PR — no merge needed).
declare function __sentrySmokeTest_undefinedFn__(): void;

export function GET() {
  __sentrySmokeTest_undefinedFn__(); // ReferenceError at runtime → Sentry
  return NextResponse.json({ ok: true });
}
