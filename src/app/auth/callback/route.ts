import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase/admin";
import { createHmac } from "crypto";

function signResetToken(userId: string): string {
  const ts = Date.now().toString();
  const secret = process.env.CRON_SECRET ?? "dev-reset-secret";
  const sig = createHmac("sha256", secret)
    .update(`${userId}:${ts}`)
    .digest("hex");
  return Buffer.from(JSON.stringify({ uid: userId, ts, sig })).toString("base64url");
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  const host = request.headers.get("host") ?? "localhost:3000";
  const protocol =
    host.includes("localhost") || host.includes("localtest.me") ? "http" : "https";
  const origin = `${protocol}://${host}`;

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=auth-callback-failed`);
  }

  // Collect cookies written during session exchange
  const pendingCookies: { name: string; value: string; options: Record<string, unknown> }[] = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookies) {
          for (const c of cookies) pendingCookies.push(c);
        },
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

  // Determine redirect URL
  let redirectTo = `${origin}${next}`;

  if (next === "/reset-password") {
    const token = signResetToken(user.id);
    redirectTo = `${origin}/reset-password?t=${token}`;
  } else {
    // Detect staff — check if user belongs to this location's org
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
          admin
            .from("org_users")
            .select("id")
            .eq("user_id", user.id)
            .eq("organization_id", location.organization_id)
            .maybeSingle(),
          admin
            .from("location_users")
            .select("id")
            .eq("user_id", user.id)
            .eq("location_id", location.id)
            .maybeSingle(),
        ]);

        if (orgCheck.data || locCheck.data) {
          redirectTo = `${origin}/staff`;
        }
      }
    }
  }

  // Build redirect response and apply session cookies
  const response = NextResponse.redirect(redirectTo);
  for (const { name, value, options } of pendingCookies) {
    response.cookies.set(name, value, options as Parameters<typeof response.cookies.set>[2]);
  }
  return response;
}
