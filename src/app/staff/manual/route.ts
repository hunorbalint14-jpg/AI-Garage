import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import { getStaffContext } from "@/lib/staff-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Authenticated staff copy of the user manual. The support widget's citation
// chips link here with portal-prefixed anchors (/staff/manual#staff-bookings).
// The built HTML is a complete standalone document (docs/internal/, kept
// outside public/ so it is never served unauthenticated) — a route handler
// streams it as-is; the staff layout deliberately does not apply.
// Header set mirrors src/app/docs/[slug]/route.ts minus the share-token gate.
export async function GET(request: NextRequest) {
  const ctx = await getStaffContext();
  if (!ctx) {
    // Top-level navigation (chips open in a new tab) — redirect is correct
    // here, unlike the JSON-401 assist endpoint.
    return NextResponse.redirect(new URL("/staff/login", request.url));
  }

  const filePath = path.join(process.cwd(), "docs/internal/user-guide.html");
  let html: string;
  try {
    html = await fs.readFile(filePath, "utf-8");
  } catch (err) {
    console.error("[staff-manual] failed to read user-guide.html", err);
    return new NextResponse("Manual not available.", { status: 404 });
  }

  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Robots-Tag": "noindex, nofollow",
      "Cache-Control": "private, no-store, must-revalidate",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
