import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

// Tenant subscription tiers (the platform's own SaaS plans, billed on the
// PLATFORM Stripe account). Hybrid model: each tier sets the per-payment
// platform fee AND unlocks features. Prices here are placeholders — tune them
// and create the matching Stripe Prices on the platform account, then set the
// env ids below. Starter is free (no Stripe Price). PR1 tracks billing only;
// feature gating + tier-based fee land in PR2/PR3.

export type TierKey = "starter" | "pro" | "growth";
export type FeatureKey = "xero" | "campaigns" | "automations";

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
    features: { xero: false, campaigns: false, automations: false },
    maxLocations: 1,
  },
  pro: {
    key: "pro",
    name: "Pro",
    monthlyPence: 4900,
    annualPence: 49000,
    feePercent: 1.5,
    priceMonthlyEnv: "STRIPE_TENANT_PRICE_PRO_MONTHLY",
    priceAnnualEnv: "STRIPE_TENANT_PRICE_PRO_ANNUAL",
    features: { xero: true, campaigns: true, automations: true },
    maxLocations: 3,
  },
  growth: {
    key: "growth",
    name: "Growth",
    monthlyPence: 9900,
    annualPence: 99000,
    feePercent: 1.0,
    priceMonthlyEnv: "STRIPE_TENANT_PRICE_GROWTH_MONTHLY",
    priceAnnualEnv: "STRIPE_TENANT_PRICE_GROWTH_ANNUAL",
    features: { xero: true, campaigns: true, automations: true },
    maxLocations: Number.POSITIVE_INFINITY,
  },
};

export const TENANT_BILLING_GRACE_DAYS = 7;

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
  xero: "Xero sync is a Pro feature. Upgrade your plan in Settings → Billing.",
  campaigns: "Campaigns are a Pro feature. Upgrade your plan in Settings → Billing.",
  automations: "Automations are a Pro feature. Upgrade your plan in Settings → Billing.",
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

// Whether the tenant is in good standing. Starter is free (always active). Paid
// tiers: active/trialing, or a live trial, or past_due still inside the grace
// window. Used by PR2 enforcement; PR1 only surfaces it.
export function tenantBillingActive(org: OrgBilling, now: Date = new Date()): boolean {
  if (tierFor(org).key === "starter") return true;
  if (org.tenant_trial_end && new Date(org.tenant_trial_end) > now) return true;
  const status = org.tenant_subscription_status;
  if (status === "active" || status === "trialing") return true;
  if (status === "past_due" && org.tenant_current_period_end) {
    const graceEnd = new Date(org.tenant_current_period_end);
    graceEnd.setDate(graceEnd.getDate() + TENANT_BILLING_GRACE_DAYS);
    return graceEnd > now;
  }
  return false;
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
    const tier = priceId ? tierForStripePrice(priceId) : null;
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
