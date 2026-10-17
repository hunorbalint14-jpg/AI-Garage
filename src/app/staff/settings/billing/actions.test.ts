import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/staff-context", () => ({ requireStaffContext: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/stripe", () => ({
  tenantOrigin: (slug: string) => `https://${slug}.ai-garage.co.uk`,
  stripe: {
    subscriptions: { list: vi.fn(async () => ({ data: [] })) },
    checkout: { sessions: { create: vi.fn(async () => ({ url: "https://checkout.stripe.com/c/x" })) } },
  },
}));

const { requireStaffContext } = await import("@/lib/staff-context");
const { createAdminClient } = await import("@/lib/supabase/admin");
const { stripe } = await import("@/lib/stripe");
const { startTenantCheckout } = await import("./actions");

const DAY = 86_400_000;

// Every organizations read in the action is select→eq→maybeSingle; one row
// carries all the columns it asks for.
function adminWith(row: Record<string, unknown>) {
  const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: row }) };
  return { from: () => chain } as never;
}

function checkoutWith(org: { tenant_trial_end: string | null; tenant_subscription_status: string | null }) {
  vi.mocked(createAdminClient).mockReturnValue(adminWith({ tenant_stripe_customer_id: "cus_1", ...org }));
  return startTenantCheckout("pro", "month");
}

const subscriptionData = () =>
  (vi.mocked(stripe.checkout.sessions.create).mock.calls[0][0] as { subscription_data: Record<string, unknown> })
    .subscription_data;

describe("startTenantCheckout — courtesy-trial carry-over", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_TENANT_PRICE_PRO_MONTHLY = "price_pro_m";
    vi.mocked(requireStaffContext).mockResolvedValue({
      orgRole: "owner",
      organization: { id: "org_1", name: "Smith Motors", slug: "smith-motors" },
      user: { id: "u_1", email: "owner@example.com" },
    } as never);
  });

  it("starts the subscription trialing until the granted trial end", async () => {
    const end = new Date(Date.now() + 40 * DAY);
    expect(await checkoutWith({ tenant_trial_end: end.toISOString(), tenant_subscription_status: null })).toEqual({
      url: "https://checkout.stripe.com/c/x",
    });
    expect(subscriptionData()).toEqual({
      metadata: { kind: "tenant_billing", organization_id: "org_1", tier: "pro" },
      trial_end: Math.floor(end.getTime() / 1000),
    });
  });

  it("bills immediately with no trial", async () => {
    await checkoutWith({ tenant_trial_end: null, tenant_subscription_status: null });
    expect(subscriptionData()).not.toHaveProperty("trial_end");
  });

  it("bills immediately once the trial is inside Stripe's 48h floor", async () => {
    await checkoutWith({ tenant_trial_end: new Date(Date.now() + DAY).toISOString(), tenant_subscription_status: null });
    expect(subscriptionData()).not.toHaveProperty("trial_end");
  });

  it("does not carry an expired trial", async () => {
    await checkoutWith({ tenant_trial_end: new Date(Date.now() - DAY).toISOString(), tenant_subscription_status: null });
    expect(subscriptionData()).not.toHaveProperty("trial_end");
  });
});
