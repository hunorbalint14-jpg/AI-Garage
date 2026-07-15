import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

// Tenant subscription tiers (the platform's own SaaS plans, billed on the
// PLATFORM Stripe account). Hybrid model: the payment fee (feePercent) carries
// the small tiers; the top tier is flat SaaS priced on locations.
//
// Pricing (final, 2026-07, benchmarked against UK garage software):
//   - The payment fee TAPERS to zero as the tier rises (Starter 2% → Pro 1% →
//     Growth 0%). A garage graduates off the fee as it scales, instead of the
//     fee compounding into a churn cliff at high card volume.
//   - Growth is a flat £149/mo (no payment fee) covering up to 7 locations;
//     beyond 7, +£25/location (perExtraLocationPence). The over-cap overage is
//     NOT yet automated — Growth is self-serve capped at 7, and 8+ sites are
//     handled by arrangement until the metered-billing follow-up lands.
//   - Annual = 10× monthly (two months free). Starter is free (no Stripe Price).
//
// IMPORTANT: the Stripe Prices referenced by the *Env ids below must be created
// on the platform account at these exact amounts. The billing page renders
// monthlyPence/annualPence from here, but customers are charged the Stripe
// Price — if the two diverge, the page and the receipt disagree.

export type TierKey = "starter" | "pro" | "growth";
export type FeatureKey = "accounting" | "campaigns" | "automations" | "receptionist";

export type TierConfig = {
  key: TierKey;
  name: string;
  monthlyPence: number;
  annualPence: number;
  feePercent: number;
  priceMonthlyEnv: string | null;
  priceAnnualEnv: string | null;
  features: Record<FeatureKey, boolean>;
  maxLocations: number; // Number.POSITIVE_INFINITY for unlimited
  /** Price per location beyond maxLocations (Growth only). The over-cap
   *  overage is not yet metered — see the tier comment above. */
  perExtraLocationPence?: number | null;
};

export const TIERS: Record<TierKey, TierConfig> = {
  starter: {
    key: "starter",
    name: "Starter",
    monthlyPence: 0,
    annualPence: 0,
    feePercent: 2.0,
    priceMonthlyEnv: null,
    priceAnnualEnv: null,
    features: { accounting: false, campaigns: false, automations: false, receptionist: false },
    maxLocations: 1,
  },
  pro: {
    key: "pro",
    name: "Pro",
    monthlyPence: 4900,
    annualPence: 49000,
    feePercent: 1.0,
    priceMonthlyEnv: "STRIPE_TENANT_PRICE_PRO_MONTHLY",
    priceAnnualEnv: "STRIPE_TENANT_PRICE_PRO_ANNUAL",
    features: { accounting: true, campaigns: true, automations: true, receptionist: false },
    maxLocations: 3,
  },
  growth: {
    key: "growth",
    name: "Growth",
    monthlyPence: 14900,
    annualPence: 149000,
    feePercent: 0,
    priceMonthlyEnv: "STRIPE_TENANT_PRICE_GROWTH_MONTHLY",
    priceAnnualEnv: "STRIPE_TENANT_PRICE_GROWTH_ANNUAL",
    features: { accounting: true, campaigns: true, automations: true, receptionist: true },
    maxLocations: 7,
    perExtraLocationPence: 2500,
  },
};

export const TENANT_BILLING_GRACE_DAYS = 7;

// How close to the trial end the "trial ending" warning starts showing.
export const TRIAL_ENDING_WINDOW_DAYS = 7;

export type OrgBilling = {
  tenant_plan: string | null;
  tenant_subscription_status: string | null;
  tenant_current_period_end: string | null;
  tenant_trial_end: string | null;
};

export function tierFor(org: Pick<OrgBilling, "tenant_plan">): TierConfig {
  return TIERS[(org.tenant_plan as TierKey) ?? "starter"] ?? TIERS.starter;
}

export function tierFeePercent(org: Pick<OrgBilling, "tenant_plan">): number {
  return tierFor(org).feePercent;
}

// The platform fee % to actually charge: the tier's rate while billing is in
// good standing, else the Starter rate (a lapsed tier loses its lower fee).
export function effectiveFeePercent(org: OrgBilling, now: Date = new Date()): number {
  return tenantBillingActive(org, now) ? tierFor(org).feePercent : TIERS.starter.feePercent;
}

export function tenantHasFeature(org: Pick<OrgBilling, "tenant_plan">, key: FeatureKey): boolean {
  return tierFor(org).features[key];
}

// Gate a premium feature: the org's tier must include it AND billing must be in
// good standing (so a lapsed/past-grace tenant loses premium features but keeps
// core trading). Used by server actions + page banners.
export function entitledTo(org: OrgBilling, key: FeatureKey, now: Date = new Date()): boolean {
  return tenantHasFeature(org, key) && tenantBillingActive(org, now);
}

export const UPGRADE_MESSAGE: Record<FeatureKey, string> = {
  accounting: "Accounting sync (Xero / QuickBooks) is a Pro feature. Upgrade your plan in Settings → Billing.",
  campaigns: "Campaigns are a Pro feature. Upgrade your plan in Settings → Billing.",
  automations: "Automations are a Pro feature. Upgrade your plan in Settings → Billing.",
  receptionist: "The AI receptionist is a Growth feature. Upgrade your plan in Settings → Billing.",
};

// Resolve the env-configured Stripe Price id for a tier + interval (null when not
// configured or for the free Starter tier).
export function tenantPriceId(tier: TierKey, interval: "month" | "year"): string | null {
  const cfg = TIERS[tier];
  const env = interval === "month" ? cfg.priceMonthlyEnv : cfg.priceAnnualEnv;
  return env ? (process.env[env] ?? null) : null;
}

// Map a Stripe Price id back to its tier (for webhook reconciliation).
export function tierForStripePrice(priceId: string): TierKey | null {
  for (const tier of Object.keys(TIERS) as TierKey[]) {
    if (
      tenantPriceId(tier, "month") === priceId ||
      tenantPriceId(tier, "year") === priceId
    ) {
      return tier;
    }
  }
  return null;
}

// The tenant billing lifecycle, in order of health. See
// docs/billing-lapse-policy.md for the full policy; the invariant is that no
// state ever gates core trading (jobs, invoices, payments) — only premium
// features and the fee rate change.
//   ok           — free Starter, a live subscription, or a courtesy trial with
//                  plenty of runway
//   trial_ending — courtesy trial live but inside TRIAL_ENDING_WINDOW_DAYS
//   grace        — subscription past_due, still inside the grace window
//   trial_ended  — courtesy trial expired and the org never subscribed
//   lapsed       — grace expired, or the subscription was canceled / went
//                  unpaid; premium features off, fee back to the Starter rate
export type BillingState =
  | { state: "ok" }
  | { state: "trial_ending"; until: string }
  | { state: "grace"; until: string }
  | { state: "trial_ended"; since: string }
  | { state: "lapsed" };

export function tenantBillingState(org: OrgBilling, now: Date = new Date()): BillingState {
  if (tierFor(org).key === "starter") return { state: "ok" };

  const status = org.tenant_subscription_status;
  if (status === "active" || status === "trialing") return { state: "ok" };

  // No live subscription — a live courtesy trial (grandfathered orgs) still
  // keeps the paid tier active, and takes precedence over a dead status.
  const trialEnd = org.tenant_trial_end ? new Date(org.tenant_trial_end) : null;
  if (trialEnd && trialEnd > now) {
    const windowMs = TRIAL_ENDING_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    return trialEnd.getTime() - now.getTime() <= windowMs
      ? { state: "trial_ending", until: trialEnd.toISOString() }
      : { state: "ok" };
  }

  if (status === "past_due" && org.tenant_current_period_end) {
    const graceEnd = new Date(org.tenant_current_period_end);
    graceEnd.setDate(graceEnd.getDate() + TENANT_BILLING_GRACE_DAYS);
    if (graceEnd > now) return { state: "grace", until: graceEnd.toISOString() };
  }

  // Trial expired and they never subscribed at all — distinct from a lapsed
  // subscription so the owner sees "trial ended", not "payment failed".
  if (trialEnd && !status) return { state: "trial_ended", since: trialEnd.toISOString() };
  return { state: "lapsed" };
}

// Whether the tenant is in good standing. Starter is free (always active). Paid
// tiers: active/trialing, or a live trial, or past_due still inside the grace
// window. Used by PR2 enforcement; PR1 only surfaces it.
export function tenantBillingActive(org: OrgBilling, now: Date = new Date()): boolean {
  const s = tenantBillingState(org, now).state;
  return s === "ok" || s === "trial_ending" || s === "grace";
}

// Apply a platform-account tenant subscription to its organization (idempotent).
// Cancelled/expired → drop back to the free Starter tier. Never throws.
export async function recordTenantSubscription(admin: Admin, sub: Stripe.Subscription): Promise<void> {
  try {
    const orgId = sub.metadata?.organization_id;
    if (!orgId) {
      console.error("[tenant-billing] subscription missing organization_id", { sub: sub.id });
      return;
    }
    const item = sub.items?.data?.[0];
    const priceId = item?.price?.id;
    // The price the customer is actually on is the source of truth: a Billing
    // Portal plan switch (e.g. Pro → Growth) changes the price but NOT the tier
    // we stamped in metadata at checkout. So map the price first, and only fall
    // back to the stamped tier when the price id isn't recognised (e.g. a
    // STRIPE_TENANT_PRICE_* env mismatch between test/live).
    const priceTier = priceId ? tierForStripePrice(priceId) : null;
    const metaTier = sub.metadata?.tier;
    const fallbackTier: TierKey | null =
      metaTier === "starter" || metaTier === "pro" || metaTier === "growth" ? metaTier : null;
    const tier: TierKey | null = priceTier ?? fallbackTier;
    const periodEndUnix = item?.current_period_end ?? null;
    const customerId = typeof sub.customer === "string" ? sub.customer : (sub.customer?.id ?? null);
    const ended = sub.status === "canceled" || sub.status === "incomplete_expired";

    const { error } = await admin
      .from("organizations")
      .update({
        tenant_plan: ended ? "starter" : (tier ?? "starter"),
        tenant_subscription_status: sub.status,
        tenant_stripe_customer_id: customerId,
        tenant_stripe_subscription_id: sub.id,
        tenant_current_period_end: periodEndUnix ? new Date(periodEndUnix * 1000).toISOString() : null,
      })
      .eq("id", orgId);
    if (error) console.error("[tenant-billing] org update failed", { orgId, error: error.message });
  } catch (err) {
    console.error("[tenant-billing] recordTenantSubscription threw", err);
  }
}
