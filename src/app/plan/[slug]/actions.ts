"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { stripe, tenantOrigin } from "@/lib/stripe";
import { verifyPlanInviteAccess } from "@/lib/plan-invites";
import {
  ensurePlanStripePrices,
  planPriceForInterval,
  PLATFORM_FEE_PERCENT,
  type ServicePlanRow,
  type PlanInterval,
} from "@/lib/service-plans";

export type AcceptResult = { error: string } | { url: string };

const PLAN_SELECT =
  "id, location_id, name, description, price_monthly_pence, price_annual_pence, stripe_product_id, stripe_price_monthly_id, stripe_price_annual_id, active";

// Public, token-gated. Re-verify the invite server-side (never trust the
// client), then start a subscription Checkout on the garage's connected
// account. The plan_subscriptions row + invite status are written by the
// webhook on checkout.session.completed.
export async function acceptPlanInvite(
  slug: string,
  token: string,
  interval: PlanInterval,
): Promise<AcceptResult> {
  if (interval !== "month" && interval !== "year") return { error: "Invalid billing option." };

  const verified = await verifyPlanInviteAccess(slug, token);
  if (!verified.ok) return { error: "This invite link is no longer valid." };
  const invite = verified.invite;

  const admin = createAdminClient();

  const { data: planRow } = await admin
    .from("service_plans")
    .select(PLAN_SELECT)
    .eq("id", invite.service_plan_id)
    .eq("location_id", invite.location_id)
    .maybeSingle();
  const plan = planRow as ServicePlanRow | null;
  if (!plan || !plan.active) return { error: "This plan isn't available." };

  const priced = planPriceForInterval(plan, interval);
  if (!priced) return { error: "That billing option isn't available." };

  const { data: locRow } = await admin
    .from("locations")
    .select("slug, organization:organizations!organization_id(id, stripe_account_id, stripe_charges_enabled)")
    .eq("id", invite.location_id)
    .maybeSingle();
  const loc = locRow as unknown as {
    slug: string;
    organization: { id: string; stripe_account_id: string | null; stripe_charges_enabled: boolean | null } | null;
  } | null;
  const org = loc?.organization;
  if (!loc || !org?.stripe_account_id || !org.stripe_charges_enabled) {
    return { error: "This garage hasn't finished setting up online payments yet." };
  }

  let customerEmail: string | undefined;
  if (invite.customer_id) {
    const { data: c } = await admin
      .from("customers")
      .select("email")
      .eq("id", invite.customer_id)
      .maybeSingle();
    customerEmail = (c as { email: string | null } | null)?.email ?? undefined;
  }

  let priceId = priced.stripePriceId;
  if (!priceId) {
    try {
      const ids = await ensurePlanStripePrices(admin, plan, org.stripe_account_id);
      priceId = interval === "month" ? ids.stripe_price_monthly_id : ids.stripe_price_annual_id;
    } catch (err) {
      console.error("[plan-invite] ensurePlanStripePrices failed", err);
      return { error: "Could not start the subscription. Please try again later." };
    }
  }
  if (!priceId) return { error: "That billing option isn't available." };

  const origin = tenantOrigin(loc.slug);
  const metadata = {
    kind: "service_plan",
    service_plan_id: plan.id,
    customer_id: invite.customer_id ?? "",
    location_id: invite.location_id,
    interval,
    plan_invite_id: invite.id,
  };

  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        customer_email: customerEmail,
        line_items: [{ price: priceId, quantity: 1 }],
        subscription_data: { application_fee_percent: PLATFORM_FEE_PERCENT, metadata },
        metadata,
        success_url: `${origin}/plan/${slug}/done`,
        cancel_url: `${origin}/plan/${slug}?t=${encodeURIComponent(token)}`,
      },
      { stripeAccount: org.stripe_account_id },
    );
    if (!session.url) return { error: "Stripe did not return a checkout URL." };
    return { url: session.url };
  } catch (err) {
    console.error("[plan-invite] checkout create failed", err);
    return { error: "Could not start the subscription. Please try again later." };
  }
}
