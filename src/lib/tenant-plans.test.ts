import { describe, it, expect, afterEach } from "vitest";
import {
  TIERS,
  tierFor,
  tierFeePercent,
  tenantHasFeature,
  tenantPriceId,
  tierForStripePrice,
  tenantBillingActive,
  effectiveFeePercent,
} from "./tenant-plans";

describe("tierFor / tierFeePercent / tenantHasFeature", () => {
  it("defaults unknown / null plans to Starter", () => {
    expect(tierFor({ tenant_plan: null }).key).toBe("starter");
    expect(tierFor({ tenant_plan: "bogus" }).key).toBe("starter");
  });
  it("maps tier → fee + features", () => {
    expect(tierFeePercent({ tenant_plan: "starter" })).toBe(2.0);
    expect(tierFeePercent({ tenant_plan: "pro" })).toBe(1.5);
    expect(tierFeePercent({ tenant_plan: "growth" })).toBe(1.0);
    expect(tenantHasFeature({ tenant_plan: "starter" }, "xero")).toBe(false);
    expect(tenantHasFeature({ tenant_plan: "pro" }, "xero")).toBe(true);
  });
});

describe("tenantPriceId / tierForStripePrice", () => {
  afterEach(() => {
    delete process.env.STRIPE_TENANT_PRICE_PRO_MONTHLY;
    delete process.env.STRIPE_TENANT_PRICE_GROWTH_ANNUAL;
  });
  it("returns null for the free Starter tier", () => {
    expect(tenantPriceId("starter", "month")).toBeNull();
  });
  it("reads the env price id and maps it back", () => {
    process.env.STRIPE_TENANT_PRICE_PRO_MONTHLY = "price_pro_m";
    process.env.STRIPE_TENANT_PRICE_GROWTH_ANNUAL = "price_growth_y";
    expect(tenantPriceId("pro", "month")).toBe("price_pro_m");
    expect(tierForStripePrice("price_pro_m")).toBe("pro");
    expect(tierForStripePrice("price_growth_y")).toBe("growth");
    expect(tierForStripePrice("price_unknown")).toBeNull();
  });
});

describe("tenantBillingActive", () => {
  const now = new Date("2026-06-05T00:00:00Z");
  const future = "2026-07-01T00:00:00Z";
  const past = "2026-06-01T00:00:00Z";

  it("free Starter is always active", () => {
    expect(tenantBillingActive({ tenant_plan: "starter", tenant_subscription_status: null, tenant_current_period_end: null, tenant_trial_end: null }, now)).toBe(true);
  });
  it("a live trial keeps a paid tier active", () => {
    expect(tenantBillingActive({ tenant_plan: "pro", tenant_subscription_status: null, tenant_current_period_end: null, tenant_trial_end: future }, now)).toBe(true);
  });
  it("active / trialing status is active; expired is not", () => {
    expect(tenantBillingActive({ tenant_plan: "pro", tenant_subscription_status: "active", tenant_current_period_end: null, tenant_trial_end: null }, now)).toBe(true);
    expect(tenantBillingActive({ tenant_plan: "pro", tenant_subscription_status: "canceled", tenant_current_period_end: past, tenant_trial_end: null }, now)).toBe(false);
  });
  it("past_due stays active inside the grace window, not after", () => {
    // period end 2026-06-01 + 7 days grace = 2026-06-08 > now → active
    expect(tenantBillingActive({ tenant_plan: "pro", tenant_subscription_status: "past_due", tenant_current_period_end: past, tenant_trial_end: null }, now)).toBe(true);
    // period end far in the past → grace expired
    expect(tenantBillingActive({ tenant_plan: "pro", tenant_subscription_status: "past_due", tenant_current_period_end: "2026-05-01T00:00:00Z", tenant_trial_end: null }, now)).toBe(false);
  });
});

describe("effectiveFeePercent", () => {
  const now = new Date("2026-06-05T00:00:00Z");
  it("charges the tier fee while billing is in good standing", () => {
    expect(effectiveFeePercent({ tenant_plan: "growth", tenant_subscription_status: "active", tenant_current_period_end: null, tenant_trial_end: null }, now)).toBe(1.0);
  });
  it("falls back to the Starter fee when a paid tier has lapsed past grace", () => {
    expect(effectiveFeePercent({ tenant_plan: "growth", tenant_subscription_status: "canceled", tenant_current_period_end: "2026-05-01T00:00:00Z", tenant_trial_end: null }, now)).toBe(2.0);
  });
});

describe("TIERS config", () => {
  it("has a fee for every tier and only paid tiers carry price envs", () => {
    expect(TIERS.starter.priceMonthlyEnv).toBeNull();
    expect(TIERS.pro.priceMonthlyEnv).toBeTruthy();
    expect(TIERS.growth.feePercent).toBeLessThan(TIERS.starter.feePercent);
  });
});
