import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=auth-callback-failed`);
  }

  // Exchange the code server-side. Works for both regular sign-in and
  // password reset — the session is written to cookies which the browser
  // client loads via refreshSession() on the next page.
  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=auth-callback-failed`);
  }

  // Password reset: session is now in cookies. Go straight to the form.
  // The reset-password page calls refreshSession() to load it client-side
  // before calling updateUser().
  if (next === "/reset-password") {
    return NextResponse.redirect(`${origin}/reset-password`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(`${origin}/login?error=auth-callback-failed`);
  }

  // Check if this user is org staff. If so, send them to the staff portal.
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
        return NextResponse.redirect(`${origin}/staff`);
      }
    }
  }

  return NextResponse.redirect(`${origin}${next}`);
}
