import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase/admin";

// Builds a 200 HTML response that immediately redirects via <meta> refresh.
// Using a 200 (not 307) ensures browsers process Set-Cookie headers before
// following the redirect — Next.js does not reliably include cookies in
// NextResponse.redirect() 3xx responses.
function htmlRedirect(url: string): NextResponse {
  const html = `<!DOCTYPE html><html><head>
<meta http-equiv="refresh" content="0; url=${url}">
<script>window.location.replace(${JSON.stringify(url)})</script>
</head><body>Redirecting…</body></html>`;
  return new NextResponse(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (!code) {
    return htmlRedirect(`${origin}/login?error=auth-callback-failed`);
  }

  const redirectTarget =
    next === "/reset-password"
      ? `${origin}/reset-password`
      : `${origin}${next}`;

  const response = htmlRedirect(redirectTarget);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return htmlRedirect(`${origin}/login?error=auth-callback-failed`);
  }

  if (next === "/reset-password") {
    return response;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return htmlRedirect(`${origin}/login?error=auth-callback-failed`);
  }

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
        const staffResponse = htmlRedirect(`${origin}/staff`);
        response.cookies.getAll().forEach(({ name, value, ...options }) => {
          staffResponse.cookies.set(name, value, options);
        });
        return staffResponse;
      }
    }
  }

  return response;
}
