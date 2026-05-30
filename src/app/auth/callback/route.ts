import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeInternalPath } from "@/lib/safe-redirect";
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
  const next = safeInternalPath(searchParams.get("next"), "/dashboard");

  const host = request.headers.get("host") ?? "localhost:3000";
  const protocol =
    host.includes("localhost") || host.includes("localtest.me") ? "http" : "https";
  const origin = `${protocol}://${host}`;

  if (!code) {
    // Magiclink + invite emails generated via the admin API redirect with
    // tokens in the URL fragment (#access_token=...&refresh_token=...) — the
    // legacy "implicit" flow. The hash never reaches the server, so we
    // return a tiny HTML bridge that reads it client-side, posts the tokens
    // to /api/auth/set-session (which writes the session cookies), and
    // then navigates to `next`.
    const fallback = `${origin}/login?error=auth-callback-failed`;
    const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Signing you in…</title></head>
<body>
<p style="font-family:system-ui;padding:24px">Signing you in…</p>
<script>
(function () {
  var hash = (window.location.hash || "").replace(/^#/, "");
  if (!hash) { window.location.replace(${JSON.stringify(fallback)}); return; }
  var p = new URLSearchParams(hash);
  var at = p.get("access_token");
  var rt = p.get("refresh_token");
  if (!at || !rt) { window.location.replace(${JSON.stringify(fallback)}); return; }
  fetch("/api/auth/set-session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ access_token: at, refresh_token: rt }),
  }).then(function (r) {
    if (!r.ok) { window.location.replace(${JSON.stringify(fallback)}); return; }
    window.location.replace(${JSON.stringify(next)});
  }).catch(function () {
    window.location.replace(${JSON.stringify(fallback)});
  });
})();
</script>
</body></html>`;
    return new NextResponse(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
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
    const { resolveTenantFromHost } = await import("@/lib/tenant");
    const slug =
      request.headers.get("x-tenant-slug") ??
      resolveTenantFromHost(request.headers.get("host") ?? "").slug;

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
