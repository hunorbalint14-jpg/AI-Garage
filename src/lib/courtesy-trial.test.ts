import { describe, it, expect } from "vitest";
import { courtesyTrialEnd, hasBilledSubscription } from "./courtesy-trial";
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
