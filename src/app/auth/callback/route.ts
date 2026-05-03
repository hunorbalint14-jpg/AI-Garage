import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase/admin";

type PendingCookie = {
  name: string;
  value: string;
  options?: {
    path?: string;
    maxAge?: number;
    sameSite?: string;
    httpOnly?: boolean;
    secure?: boolean;
    domain?: string;
  };
};

function buildSetCookieHeader(c: PendingCookie): string {
  const parts = [`${c.name}=${encodeURIComponent(c.value)}`];
  if (c.options?.path) parts.push(`Path=${c.options.path}`);
  if (c.options?.maxAge !== undefined) parts.push(`Max-Age=${c.options.maxAge}`);
  if (c.options?.sameSite) parts.push(`SameSite=${c.options.sameSite}`);
  if (c.options?.domain) parts.push(`Domain=${c.options.domain}`);
  if (c.options?.httpOnly) parts.push("HttpOnly");
  if (c.options?.secure) parts.push("Secure");
  return parts.join("; ");
}

function htmlRedirectResponse(
  url: string,
  cookies: PendingCookie[],
): Response {
  const html = `<!DOCTYPE html><html><head>
<meta http-equiv="refresh" content="0; url=${url}">
<script>window.location.replace(${JSON.stringify(url)})</script>
</head><body>Redirecting…</body></html>`;

  const headers = new Headers({ "content-type": "text/html; charset=utf-8" });
  cookies.forEach((c) => headers.append("set-cookie", buildSetCookieHeader(c)));
  return new Response(html, { status: 200, headers });
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=auth-callback-failed`);
  }

  const pendingCookies: PendingCookie[] = [];

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
            pendingCookies.push({
              name,
              value,
              options: {
                path: options?.path,
                maxAge: options?.maxAge,
                sameSite: typeof options?.sameSite === "string" ? options.sameSite : undefined,
                httpOnly: options?.httpOnly,
                secure: options?.secure,
                domain: options?.domain,
              },
            });
          });
        },
      },
    },
  );

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=auth-callback-failed`);
  }

  // Password reset: session is in pendingCookies — deliver via 200 HTML
  // response so browser processes Set-Cookie before the redirect.
  if (next === "/reset-password") {
    return htmlRedirectResponse(`${origin}/reset-password`, pendingCookies);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(`${origin}/login?error=auth-callback-failed`);
  }

  // Detect staff and redirect accordingly.
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
        return htmlRedirectResponse(`${origin}/staff`, pendingCookies);
      }
    }
  }

  return htmlRedirectResponse(`${origin}${next}`, pendingCookies);
}
