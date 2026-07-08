import { describe, it, expect, afterEach } from "vitest";
import {
  TIERS,
  tierFor,
  tierFeePercent,
  tenantHasFeature,
  tenantPriceId,
  tierForStripePrice,
  tenantBillingActive,
  tenantBillingState,
  effectiveFeePercent,
  entitledTo,
  type OrgBilling,
} from "./tenant-plans";

const org = (over: Partial<OrgBilling>): OrgBilling => ({
  tenant_plan: "pro",
  tenant_subscription_status: null,
  tenant_current_period_end: null,
  tenant_trial_end: null,
  ...over,
});

describe("tierFor / tierFeePercent / tenantHasFeature", () => {
  it("defaults unknown / null plans to Starter", () => {
    expect(tierFor({ tenant_plan: null }).key).toBe("starter");
    expect(tierFor({ tenant_plan: "bogus" }).key).toBe("starter");
  });
  it("maps tier → fee + features", () => {
    expect(tierFeePercent({ tenant_plan: "starter" })).toBe(2.0);
    expect(tierFeePercent({ tenant_plan: "pro" })).toBe(1.0);
    expect(tierFeePercent({ tenant_plan: "growth" })).toBe(0);
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
  it("unpaid and expired-trial paid tiers are not active", () => {
    expect(tenantBillingActive(org({ tenant_subscription_status: "unpaid" }), now)).toBe(false);
    expect(tenantBillingActive(org({ tenant_trial_end: past }), now)).toBe(false);
  });
});

describe("tenantBillingState", () => {
  const now = new Date("2026-06-05T00:00:00Z");
  const past = "2026-06-01T00:00:00Z";

  it("Starter and live subscriptions are ok", () => {
    expect(tenantBillingState(org({ tenant_plan: "starter" }), now).state).toBe("ok");
    expect(tenantBillingState(org({ tenant_subscription_status: "active" }), now).state).toBe("ok");
    expect(tenantBillingState(org({ tenant_subscription_status: "trialing" }), now).state).toBe("ok");
  });
  it("a courtesy trial is ok until the last week, then trial_ending", () => {
    expect(tenantBillingState(org({ tenant_trial_end: "2026-07-01T00:00:00Z" }), now).state).toBe("ok");
    const s = tenantBillingState(org({ tenant_trial_end: "2026-06-10T00:00:00Z" }), now);
    expect(s).toEqual({ state: "trial_ending", until: "2026-06-10T00:00:00.000Z" });
  });
  it("an expired courtesy trial with no subscription is trial_ended", () => {
    expect(tenantBillingState(org({ tenant_trial_end: past }), now)).toEqual({
      state: "trial_ended",
      since: "2026-06-01T00:00:00.000Z",
    });
  });
  it("past_due is grace until period end + grace days, then lapsed", () => {
    const inGrace = tenantBillingState(
      org({ tenant_subscription_status: "past_due", tenant_current_period_end: past }),
      now,
    );
    expect(inGrace).toEqual({ state: "grace", until: "2026-06-08T00:00:00.000Z" });
    expect(
      tenantBillingState(
        org({ tenant_subscription_status: "past_due", tenant_current_period_end: "2026-05-01T00:00:00Z" }),
        now,
      ).state,
    ).toBe("lapsed");
  });
  it("canceled / unpaid subscriptions are lapsed, even with an old trial date", () => {
    expect(tenantBillingState(org({ tenant_subscription_status: "canceled" }), now).state).toBe("lapsed");
    expect(tenantBillingState(org({ tenant_subscription_status: "unpaid" }), now).state).toBe("lapsed");
    // Dead status + expired trial → the subscription's failure wins the message.
    expect(
      tenantBillingState(org({ tenant_subscription_status: "canceled", tenant_trial_end: past }), now).state,
    ).toBe("lapsed");
  });
  it("a live trial outranks a dead subscription status", () => {
    expect(
      tenantBillingState(
        org({ tenant_subscription_status: "canceled", tenant_trial_end: "2026-07-01T00:00:00Z" }),
        now,
      ).state,
    ).toBe("ok");
  });
});

describe("effectiveFeePercent", () => {
  const now = new Date("2026-06-05T00:00:00Z");
  it("charges the tier fee while billing is in good standing", () => {
    // Pro carries a 1% fee; Growth is flat (no payment fee).
    expect(effectiveFeePercent({ tenant_plan: "pro", tenant_subscription_status: "active", tenant_current_period_end: null, tenant_trial_end: null }, now)).toBe(1.0);
    expect(effectiveFeePercent({ tenant_plan: "growth", tenant_subscription_status: "active", tenant_current_period_end: null, tenant_trial_end: null }, now)).toBe(0);
  });
  it("falls back to the Starter fee when a paid tier has lapsed past grace", () => {
    expect(effectiveFeePercent({ tenant_plan: "growth", tenant_subscription_status: "canceled", tenant_current_period_end: "2026-05-01T00:00:00Z", tenant_trial_end: null }, now)).toBe(2.0);
  });
});

// Simulated lapsed tenant (issue #453 acceptance): a Growth org whose
// subscription went unpaid past grace. Premium features gate off and the fee
// reverts, but nothing here can block core trading — payments still process
// (at the Starter fee), and the stamped tier/config is preserved for reactivation.
describe("lapsed tenant end-to-end invariants", () => {
  const now = new Date("2026-06-05T00:00:00Z");
  const lapsed = org({
    tenant_plan: "growth",
    tenant_subscription_status: "unpaid",
    tenant_current_period_end: "2026-04-01T00:00:00Z",
  });

  it("loses premium entitlements but keeps the tier's config intact", () => {
    expect(tenantBillingState(lapsed, now).state).toBe("lapsed");
    for (const key of ["xero", "campaigns", "automations", "receptionist"] as const) {
      expect(entitledTo(lapsed, key, now)).toBe(false);
      expect(tenantHasFeature(lapsed, key)).toBe(true); // config survives → instant restore on payment
    }
  });
  it("still charges payments — at the Starter fee, never a blocked payment", () => {
    expect(effectiveFeePercent(lapsed, now)).toBe(2.0);
  });
});

describe("TIERS config", () => {
  it("has a fee for every tier and only paid tiers carry price envs", () => {
    expect(TIERS.starter.priceMonthlyEnv).toBeNull();
    expect(TIERS.pro.priceMonthlyEnv).toBeTruthy();
    expect(TIERS.growth.feePercent).toBeLessThan(TIERS.starter.feePercent);
  });
  it("tapers the payment fee to zero as the tier rises", () => {
    expect(TIERS.starter.feePercent).toBeGreaterThan(TIERS.pro.feePercent);
    expect(TIERS.pro.feePercent).toBeGreaterThan(TIERS.growth.feePercent);
    expect(TIERS.growth.feePercent).toBe(0);
  });
  it("Growth is flat £149 covering 7 locations, then £25/site", () => {
    expect(TIERS.growth.monthlyPence).toBe(14900);
    expect(TIERS.growth.annualPence).toBe(14900 * 10); // two months free
    expect(TIERS.growth.maxLocations).toBe(7);
    expect(TIERS.growth.perExtraLocationPence).toBe(2500);
  });
});
