import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe, publicOrigin } from "@/lib/stripe";

// Stripe sends the garage here if the onboarding session expires. Generate
// a fresh Account Link and forward them back into the flow.
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/staff/login", request.url));
  }

  const admin = createAdminClient();
  const { data: orgUser } = await admin
    .from("org_users")
    .select("organization_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!orgUser) {
    return NextResponse.redirect(new URL("/staff/settings", request.url));
  }

  const { data: org } = await admin
    .from("organizations")
    .select("stripe_account_id")
    .eq("id", orgUser.organization_id)
    .maybeSingle();

  if (!org?.stripe_account_id) {
    return NextResponse.redirect(new URL("/staff/settings", request.url));
  }

  try {
    const link = await stripe.accountLinks.create({
      account: org.stripe_account_id as string,
      refresh_url: `${publicOrigin()}/api/stripe/connect/refresh`,
      return_url: `${publicOrigin()}/api/stripe/connect/return`,
      type: "account_onboarding",
    });
    return NextResponse.redirect(link.url);
  } catch (err) {
    console.error("[stripe/connect/refresh] link create failed", err);
    return NextResponse.redirect(new URL("/staff/settings?stripe=link-failed", request.url));
  }
}
