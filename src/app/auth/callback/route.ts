import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase/admin";
import { createHmac } from "crypto";

// Builds a short-lived signed token for the password reset flow.
// Token = base64url(JSON({ uid, ts, sig })) — expires in 10 min,
// signed with CRON_SECRET so it can't be forged.
function signResetToken(userId: string): string {
  const ts = Date.now().toString();
  const secret = process.env.CRON_SECRET ?? "dev-reset-secret";
  const sig = createHmac("sha256", secret)
    .update(`${userId}:${ts}`)
    .digest("hex");
  return Buffer.from(JSON.stringify({ uid: userId, ts, sig })).toString(
    "base64url",
  );
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  // Derive origin from Host header — request.url may use localhost in dev
  const host = request.headers.get("host") ?? "localhost:3000";
  const protocol =
    host.includes("localhost") || host.includes("localtest.me")
      ? "http"
      : "https";
  const origin = `${protocol}://${host}`;

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=auth-callback-failed`);
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll() { /* no-op: we don't need session cookies for the reset flow */ },
      },
    },
  );

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=auth-callback-failed`);
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(`${origin}/login?error=auth-callback-failed`);
  }

  // Password reset: sign the user ID and pass via URL — no session cookies needed.
  if (next === "/reset-password") {
    const token = signResetToken(user.id);
    return NextResponse.redirect(`${origin}/reset-password?t=${token}`);
  }

  // Regular sign-in: detect staff and redirect accordingly.
  const admin = createAdminClient();
  const slug = request.headers.get("x-tenant-slug");

  if (slug) {
    const { data: location } = await admin
      .from("locations")
      .select("id, organization_id")
      .eq("slug", slug)
      .maybeSingle();

    if (location) {
      const [orgCheck, locCheck] = await Promise.all([
        admin.from("org_users").select("id").eq("user_id", user.id).eq("organization_id", location.organization_id).maybeSingle(),
        admin.from("location_users").select("id").eq("user_id", user.id).eq("location_id", location.id).maybeSingle(),
      ]);

      if (orgCheck.data || locCheck.data) {
        return NextResponse.redirect(`${origin}/staff`);
      }
    }
  }

  return NextResponse.redirect(`${origin}${next}`);
}
