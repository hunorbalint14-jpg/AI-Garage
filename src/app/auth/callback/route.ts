import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=auth-callback-failed`);
  }

  // Determine the redirect target before building the response so we can
  // write the session cookies directly onto it (Next.js cookies() helper
  // does not attach to NextResponse.redirect, so the session would be lost).
  const redirectTarget =
    next === "/reset-password"
      ? `${origin}/reset-password`
      : `${origin}${next}`;

  const response = NextResponse.redirect(redirectTarget);

  // Exchange the code and write the resulting session cookies onto the
  // redirect response so the browser receives them in one round trip.
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
    return NextResponse.redirect(`${origin}/login?error=auth-callback-failed`);
  }

  // Password reset: session is in cookies on the response, /reset-password
  // calls refreshSession() to load it into the browser client.
  if (next === "/reset-password") {
    return response;
  }

  // Regular sign-in: detect staff and redirect accordingly.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(`${origin}/login?error=auth-callback-failed`);
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
        // Reuse response (has session cookies) but redirect to /staff
        const staffResponse = NextResponse.redirect(`${origin}/staff`);
        response.cookies.getAll().forEach(({ name, value, ...options }) => {
          staffResponse.cookies.set(name, value, options);
        });
        return staffResponse;
      }
    }
  }

  return response;
}
