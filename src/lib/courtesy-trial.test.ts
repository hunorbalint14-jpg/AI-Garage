import { describe, it, expect } from "vitest";
import { checkoutTrialEnd, courtesyTrialEnd, hasBilledSubscription } from "./courtesy-trial";
import { tenantBillingState, entitledTo, effectiveFeePercent } from "./tenant-plans";
import { orgMrrPence, billingState, type OrgOverviewRow } from "./platform-stats";

describe("courtesyTrialEnd", () => {
  it("adds calendar months, keeping time of day", () => {
    expect(courtesyTrialEnd(new Date("2026-10-17T14:30:00Z"), 3).toISOString()).toBe("2027-01-17T14:30:00.000Z");
  });

  it("clamps to the last day of a shorter month", () => {
    expect(courtesyTrialEnd(new Date("2027-01-31T09:00:00Z"), 1).toISOString()).toBe("2027-02-28T09:00:00.000Z");
    expect(courtesyTrialEnd(new Date("2027-11-30T09:00:00Z"), 3).toISOString()).toBe("2028-02-29T09:00:00.000Z");
  });

  it("rolls over the year for 12 months", () => {
    expect(courtesyTrialEnd(new Date("2026-10-17T00:00:00Z"), 12).toISOString()).toBe("2027-10-17T00:00:00.000Z");
  });
});

describe("hasBilledSubscription", () => {
  it("blocks while Stripe is billing", () => {
    for (const s of ["active", "trialing", "past_due", "unpaid", "incomplete"]) {
      expect(hasBilledSubscription({ tenant_subscription_status: s })).toBe(true);
    }
  });

  it("allows no subscription or a dead one", () => {
    expect(hasBilledSubscription({ tenant_subscription_status: null })).toBe(false);
    expect(hasBilledSubscription({ tenant_subscription_status: "canceled" })).toBe(false);
    expect(hasBilledSubscription({ tenant_subscription_status: "incomplete_expired" })).toBe(false);
  });
});

describe("granted Growth courtesy trial", () => {
  const now = new Date("2026-10-17T12:00:00Z");
  const granted = {
    tenant_plan: "growth",
    tenant_subscription_status: null,
    tenant_current_period_end: null,
    tenant_trial_end: courtesyTrialEnd(now, 3).toISOString(),
  };

  it("unlocks every premium feature at the 0% fee with no subscription", () => {
    expect(tenantBillingState(granted, now).state).toBe("ok");
    for (const f of ["accounting", "campaigns", "automations", "receptionist"] as const) {
      expect(entitledTo(granted, f, now)).toBe(true);
    }
    expect(effectiveFeePercent(granted, now)).toBe(0);
  });

  it("degrades to Starter on expiry without charging", () => {
    const after = new Date("2027-01-18T00:00:00Z");
    expect(tenantBillingState(granted, after).state).toBe("trial_ended");
    expect(entitledTo(granted, "receptionist", after)).toBe(false);
    expect(effectiveFeePercent(granted, after)).toBe(2.0);
  });

  it("counts £0 towards MRR while trialing", () => {
    const row = { ...granted, organization_id: "o", name: "x", slug: "x" } as unknown as OrgOverviewRow;
    expect(billingState(row, now)).toBe("trialing");
    expect(orgMrrPence(row, now)).toBe(0);
    expect(orgMrrPence({ ...row, tenant_trial_end: null, tenant_subscription_status: "active" }, now)).toBe(14900);
  });
});

describe("checkoutTrialEnd", () => {
  const now = new Date("2026-10-17T12:00:00Z");
  const org = (end: string | null, status: string | null = null) => ({
    tenant_trial_end: end,
    tenant_subscription_status: status,
  });

  it("carries a live courtesy trial as unix seconds", () => {
    expect(checkoutTrialEnd(org("2027-01-17T12:00:00Z"), now)).toBe(Date.parse("2027-01-17T12:00:00Z") / 1000);
    // PostgREST's "+00:00" offset parses the same.
    expect(checkoutTrialEnd(org("2027-01-17T12:00:00+00:00"), now)).toBe(Date.parse("2027-01-17T12:00:00Z") / 1000);
  });

  it("skips anything inside Stripe's 48h minimum (plus an hour of headroom)", () => {
    expect(checkoutTrialEnd(org("2026-10-19T12:00:00Z"), now)).toBeNull(); // exactly 48h
    expect(checkoutTrialEnd(org("2026-10-19T12:59:00Z"), now)).toBeNull();
    expect(checkoutTrialEnd(org("2026-10-19T13:00:00Z"), now)).toBe(Date.parse("2026-10-19T13:00:00Z") / 1000);
  });

  it("skips no trial, an expired one, or an org Stripe already bills", () => {
    expect(checkoutTrialEnd(org(null), now)).toBeNull();
    expect(checkoutTrialEnd(org("2026-10-01T00:00:00Z"), now)).toBeNull();
    expect(checkoutTrialEnd(org("2027-01-17T12:00:00Z", "active"), now)).toBeNull();
    expect(checkoutTrialEnd(org("2027-01-17T12:00:00Z", "trialing"), now)).toBeNull();
  });

  it("keeps the org in good standing once the carried-over sub is recorded trialing", () => {
    // What recordTenantSubscription writes after checkout: status trialing,
    // tenant_trial_end left as granted.
    const carried = {
      tenant_plan: "pro",
      tenant_subscription_status: "trialing",
      tenant_current_period_end: "2027-01-17T12:00:00Z",
      tenant_trial_end: "2027-01-17T12:00:00Z",
    };
    expect(tenantBillingState(carried, now).state).toBe("ok");
    // Inside the last week: no "trial ending" nudge — Stripe is about to bill.
    expect(tenantBillingState(carried, new Date("2027-01-14T00:00:00Z")).state).toBe("ok");
    // After conversion the old trial end is past but the sub is active.
    expect(tenantBillingState({ ...carried, tenant_subscription_status: "active" }, new Date("2027-02-01T00:00:00Z")).state).toBe("ok");
    expect(effectiveFeePercent(carried, now)).toBe(1.0);
  });
});
