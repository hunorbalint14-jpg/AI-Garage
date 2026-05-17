import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Cross-subdomain auth handoff. Called with ?token_hash=...&next=/staff after
// the user signs in on a different host (e.g. root marketing domain). We verify
// the OTP server-side, which sets the auth cookies on THIS subdomain, then
// redirect to the desired next page.

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const next = searchParams.get("next") || "/staff";

  if (!tokenHash) {
    return NextResponse.redirect(`${origin}/staff/login?error=missing-token`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: "magiclink",
  });

  if (error) {
    return NextResponse.redirect(
      `${origin}/staff/login?error=handoff-failed&reason=${encodeURIComponent(error.message)}`,
    );
  }

  return NextResponse.redirect(`${origin}${next}`);
}
