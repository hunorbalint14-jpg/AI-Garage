import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

// Platform fee skimmed from each garage's subscription revenue — same rate as
// the one-off payment path (STRIPE_PLATFORM_FEE_PERCENT, default 2%), applied
// as subscription_data.application_fee_percent at checkout.
export const PLATFORM_FEE_PERCENT = Number(process.env.STRIPE_PLATFORM_FEE_PERCENT ?? "2");

export type PlanInterval = "month" | "year";

export type ServicePlanRow = {
  id: string;
  location_id: string;
  name: string;
  description: string | null;
  price_monthly_pence: number | null;
  price_annual_pence: number | null;
  stripe_product_id: string | null;
  stripe_price_monthly_id: string | null;
  stripe_price_annual_id: string | null;
  active: boolean;
};

// Which pence amount + Stripe price id back a given interval. Null when the plan
// isn't priced for that interval.
export function planPriceForInterval(
  plan: Pick<
    ServicePlanRow,
    "price_monthly_pence" | "price_annual_pence" | "stripe_price_monthly_id" | "stripe_price_annual_id"
  >,
  interval: PlanInterval,
): { pence: number; stripePriceId: string | null } | null {
  if (interval === "month") {
    if (plan.price_monthly_pence == null) return null;
    return { pence: plan.price_monthly_pence, stripePriceId: plan.stripe_price_monthly_id };
  }
  if (plan.price_annual_pence == null) return null;
  return { pence: plan.price_annual_pence, stripePriceId: plan.stripe_price_annual_id };
}

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  trialing: "Trial",
  past_due: "Payment overdue",
  unpaid: "Unpaid",
  canceled: "Cancelled",
  incomplete: "Pending",
  incomplete_expired: "Expired",
  paused: "Paused",
};

export function subscriptionStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

// A subscription is "live" (grants membership) while active or trialing.
export function isSubscriptionLive(status: string): boolean {
  return status === "active" || status === "trialing";
}

// Lazily create the Stripe Product + Price(s) for a plan on the garage's
// connected account, then persist the ids. Idempotent: skips any id already
// stored. Throws on Stripe failure so the caller surfaces it.
export async function ensurePlanStripePrices(
  admin: Admin,
  plan: ServicePlanRow,
  stripeAccountId: string,
): Promise<{
  stripe_product_id: string;
  stripe_price_monthly_id: string | null;
  stripe_price_annual_id: string | null;
}> {
  const opts = { stripeAccount: stripeAccountId };
  let productId = plan.stripe_product_id;
  let monthlyId = plan.stripe_price_monthly_id;
  let annualId = plan.stripe_price_annual_id;

  if (!productId) {
    const product = await stripe.products.create(
      { name: plan.name, description: plan.description ?? undefined },
      opts,
    );
    productId = product.id;
  }

  if (plan.price_monthly_pence != null && !monthlyId) {
    const price = await stripe.prices.create(
      {
        product: productId,
        currency: "gbp",
        unit_amount: plan.price_monthly_pence,
        recurring: { interval: "month" },
      },
      opts,
    );
    monthlyId = price.id;
  }
  if (plan.price_annual_pence != null && !annualId) {
    const price = await stripe.prices.create(
      {
        product: productId,
        currency: "gbp",
        unit_amount: plan.price_annual_pence,
        recurring: { interval: "year" },
      },
      opts,
    );
    annualId = price.id;
  }

  const changed =
    productId !== plan.stripe_product_id ||
    monthlyId !== plan.stripe_price_monthly_id ||
    annualId !== plan.stripe_price_annual_id;
  if (changed) {
    await admin
      .from("service_plans")
      .update({
        stripe_product_id: productId,
        stripe_price_monthly_id: monthlyId,
        stripe_price_annual_id: annualId,
      })
      .eq("id", plan.id);
  }

  return {
    stripe_product_id: productId,
    stripe_price_monthly_id: monthlyId,
    stripe_price_annual_id: annualId,
  };
}

// Upsert a plan_subscriptions row from a Stripe Subscription (idempotent on
// stripe_subscription_id). Reads the metadata we stamped at checkout to map the
// plan / customer / location; the period end lives on the subscription item in
// this API version. Never throws — returns ok/false.
export async function recordSubscriptionFromStripe(
  admin: Admin,
  sub: Stripe.Subscription,
): Promise<{ ok: boolean }> {
  try {
    const meta = sub.metadata ?? {};
    const item = sub.items?.data?.[0];
    const periodEndUnix = item?.current_period_end ?? null;
    const itemInterval = item?.price?.recurring?.interval;
    const interval =
      itemInterval === "year" || meta.interval === "year"
        ? "year"
        : itemInterval === "month" || meta.interval === "month"
          ? "month"
          : null;
    const customerId =
      typeof sub.customer === "string" ? sub.customer : (sub.customer?.id ?? null);

    const locationId = meta.location_id || null;
    // location_id is NOT NULL in the table. Our own checkouts always stamp it;
    // bail rather than violate the constraint on a foreign subscription.
    if (!locationId) {
      console.error("[service-plans] subscription missing location metadata", { sub: sub.id });
      return { ok: false };
    }

    const { error } = await admin.from("plan_subscriptions").upsert(
      {
        location_id: locationId,
        service_plan_id: meta.service_plan_id || null,
        customer_id: meta.customer_id || null,
        stripe_subscription_id: sub.id,
        stripe_customer_id: customerId,
        interval,
        status: sub.status,
        current_period_end: periodEndUnix
          ? new Date(periodEndUnix * 1000).toISOString()
          : null,
        cancel_at_period_end: !!sub.cancel_at_period_end,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "stripe_subscription_id" },
    );
    if (error) {
      console.error("[service-plans] plan_subscriptions upsert failed", {
        sub: sub.id,
        error: error.message,
      });
      return { ok: false };
    }
    return { ok: true };
  } catch (err) {
    console.error("[service-plans] recordSubscriptionFromStripe threw", err);
    return { ok: false };
  }
}
