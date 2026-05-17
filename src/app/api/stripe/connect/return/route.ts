import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe";

// Stripe redirects here once the garage finishes (or pauses) Express
// onboarding. We pull the live account status and persist the flags before
// sending the user back to the settings page.
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

  const orgId = orgUser?.organization_id;
  if (!orgId) {
    return NextResponse.redirect(new URL("/staff/settings", request.url));
  }

  const { data: org } = await admin
    .from("organizations")
    .select("stripe_account_id")
    .eq("id", orgId)
    .maybeSingle();

  if (org?.stripe_account_id) {
    try {
      const account = await stripe.accounts.retrieve(org.stripe_account_id as string);
      await admin
        .from("organizations")
        .update({
          stripe_charges_enabled: !!account.charges_enabled,
          stripe_payouts_enabled: !!account.payouts_enabled,
          stripe_details_submitted: !!account.details_submitted,
        })
        .eq("id", orgId);
    } catch (err) {
      console.error("[stripe/connect/return] account fetch failed", err);
    }
  }

  return NextResponse.redirect(new URL("/staff/settings?stripe=return", request.url));
}
