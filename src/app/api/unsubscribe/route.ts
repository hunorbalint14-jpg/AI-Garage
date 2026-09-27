import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyUnsubscribe } from "@/lib/unsubscribe";

// RFC 8058 one-click unsubscribe (#596 PR 5). Mail providers (Gmail, Yahoo)
// POST here from their own "Unsubscribe" button when an email carries
// List-Unsubscribe + List-Unsubscribe-Post headers. The message was an email,
// so this withdraws email marketing only. Scanners fetch with GET, which only
// ever redirects to the landing page — nothing is unsubscribed without a POST.

export async function POST(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("u");
  if (token) {
    try {
      await applyUnsubscribe(createAdminClient(), token, { email: true, sms: false }, "one_click");
    } catch (err) {
      console.error("[unsubscribe] one-click failed", err);
    }
  }
  // Same response whatever happened — never confirm whether a token exists.
  return new NextResponse(null, { status: 200 });
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("u") ?? "";
  // Keep the tenant host: request.url can report the bind address in dev.
  const host = request.headers.get("host") ?? request.nextUrl.host;
  const proto =
    request.headers.get("x-forwarded-proto") ??
    (host.includes("localhost") || host.includes("localtest.me") ? "http" : "https");
  return NextResponse.redirect(`${proto}://${host}/unsubscribe?u=${encodeURIComponent(token)}`);
}
