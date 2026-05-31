import { type NextRequest, NextResponse } from "next/server";
import { parseCspReports } from "@/lib/csp-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Sink for CSP violation reports (report-to / report-uri target). Unauthenticated
// by necessity — browsers POST these without credentials. We only log a compact
// line per violation so prod reports can be reviewed before flipping CSP from
// Report-Only to enforced; nothing is persisted. Body size is capped so the
// open endpoint can't be used to flood logs with huge payloads.
const MAX_BYTES = 16_000;

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (raw.length > MAX_BYTES) return new NextResponse(null, { status: 204 });

  try {
    const violations = parseCspReports(req.headers.get("content-type") ?? "", raw);
    for (const v of violations) {
      console.warn(
        `[csp-report] ${v.directive} blocked=${v.blockedURI} doc=${v.documentURI}` +
          (v.sourceFile ? ` src=${v.sourceFile}:${v.line ?? "?"}` : ""),
      );
    }
  } catch {
    // Malformed report — ignore, never error back to the browser.
  }

  // 204: browsers ignore the body of a report response.
  return new NextResponse(null, { status: 204 });
}
