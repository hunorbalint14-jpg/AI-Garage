"use server";

import { revalidatePath } from "next/cache";
import { getPortalContext } from "@/lib/portal-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe, tenantOrigin } from "@/lib/stripe";
import { logAudit } from "@/lib/audit";
import {
  ensurePlanStripePrices,
  planPriceForInterval,
  PLATFORM_FEE_PERCENT,
  type ServicePlanRow,
  type PlanInterval,
} from "@/lib/service-plans";

export type SubscribeResult = { error: string } | { url: string };
export type CancelResult = { error: string } | { success: true };

const PLAN_SELECT =
  "id, location_id, name, description, price_monthly_pence, price_annual_pence, stripe_product_id, stripe_price_monthly_id, stripe_price_annual_id, active";

// Start a Stripe subscription Checkout for the signed-in customer. The
// Product/Price/Customer/Subscription all live on the garage's connected
// account; the platform fee is taken via application_fee_percent. The
// plan_subscriptions row is written by the webhook on checkout.session.completed.
export async function subscribeToPlan(planId: string, interval: PlanInterval): Promise<SubscribeResult> {
  const { location, customer } = await getPortalContext();
  if (!customer) return { error: "We couldn't find your customer record." };
  if (interval !== "month" && interval !== "year") return { error: "Invalid billing option." };

  const admin = createAdminClient();

  const { data: planRow } = await admin
    .from("service_plans")
    .select(PLAN_SELECT)
    .eq("id", planId)
    .eq("organization_id", location.organization.id)
    .maybeSingle();
  const plan = planRow as ServicePlanRow | null;
  if (!plan || !plan.active) return { error: "This plan isn't available." };

  const priced = planPriceForInterval(plan, interval);
  if (!priced) return { error: "That billing option isn't available for this plan." };

  const { data: orgRow } = await admin
    .from("organizations")
    .select("stripe_account_id, stripe_charges_enabled")
    .eq("id", location.organization.id)
    .maybeSingle();
  const org = orgRow as { stripe_account_id: string | null; stripe_charges_enabled: boolean | null } | null;
  if (!org?.stripe_account_id || !org.stripe_charges_enabled) {
    return { error: "This garage hasn't finished setting up online payments yet." };
  }

  // Resolve the Stripe Price id, creating it on the connected account if a staff
  // member drafted the plan before Stripe onboarding completed.
  let priceId = priced.stripePriceId;
  if (!priceId) {
    try {
      const ids = await ensurePlanStripePrices(admin, plan, org.stripe_account_id);
      priceId = interval === "month" ? ids.stripe_price_monthly_id : ids.stripe_price_annual_id;
    } catch (err) {
      console.error("[plans] ensurePlanStripePrices at subscribe failed", err);
      return { error: "Could not start the subscription. Please try again later." };
    }
  }
  if (!priceId) return { error: "That billing option isn't available for this plan." };

  const origin = tenantOrigin(location.slug);
  const metadata = {
    kind: "service_plan",
    service_plan_id: plan.id,
    customer_id: customer.id,
    // The plan's own branch is the servicing location — the webhook stamps this
    // onto plan_subscriptions.location_id. May differ from the portal's primary
    // location in a multi-location org.
    location_id: plan.location_id,
    interval,
  };

  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        customer_email: customer.email ?? undefined,
        line_items: [{ price: priceId, quantity: 1 }],
        subscription_data: {
          application_fee_percent: PLATFORM_FEE_PERCENT,
          metadata,
        },
        metadata,
        success_url: `${origin}/dashboard/plans?subscribed=1`,
        cancel_url: `${origin}/dashboard/plans`,
      },
      { stripeAccount: org.stripe_account_id },
    );

    await logAudit({
      organizationId: location.organization.id,
      actorUserId: customer.user_id,
      actorEmail: customer.email ?? null,
      action: "plan.subscribe",
      entityType: "service_plan",
      entityId: plan.id,
      metadata: { interval, checkout_session_id: session.id },
    });

    if (!session.url) return { error: "Stripe did not return a checkout URL." };
    return { url: session.url };
  } catch (err) {
    console.error("[plans] subscribe checkout create failed", err);
    return { error: "Could not start the subscription. Please try again later." };
  }
}

// Cancel at period end (the membership keeps its benefits until the paid period
// runs out). The webhook's customer.subscription.updated also reflects this.
export async function cancelSubscription(subscriptionRowId: string): Promise<CancelResult> {
  const { location, customer } = await getPortalContext();
  if (!customer) return { error: "We couldn't find your customer record." };

  const admin = createAdminClient();
  const { data: subRow } = await admin
    .from("plan_subscriptions")
    .select("id, stripe_subscription_id, customer_id")
    .eq("id", subscriptionRowId)
    .maybeSingle();
  const sub = subRow as
    | { id: string; stripe_subscription_id: string | null; customer_id: string | null }
    | null;
  if (!sub || sub.customer_id !== customer.id || !sub.stripe_subscription_id) {
    return { error: "Subscription not found." };
  }

  const { data: orgRow } = await admin
    .from("organizations")
    .select("stripe_account_id")
    .eq("id", location.organization.id)
    .maybeSingle();
  const acct = (orgRow as { stripe_account_id: string | null } | null)?.stripe_account_id;
  if (!acct) return { error: "Subscription not found." };

  try {
    await stripe.subscriptions.update(
      sub.stripe_subscription_id,
      { cancel_at_period_end: true },
      { stripeAccount: acct },
    );
    await admin
      .from("plan_subscriptions")
      .update({ cancel_at_period_end: true, updated_at: new Date().toISOString() })
      .eq("id", sub.id);

    await logAudit({
      organizationId: location.organization.id,
      actorUserId: customer.user_id,
      actorEmail: customer.email ?? null,
      action: "plan.cancel",
      entityType: "service_plan",
      entityId: sub.id,
      metadata: { stripe_subscription_id: sub.stripe_subscription_id },
    });

    revalidatePath("/dashboard/plans");
    return { success: true };
  } catch (err) {
    console.error("[plans] cancel failed", err);
    return { error: "Could not cancel right now. Please try again later." };
  }
}
