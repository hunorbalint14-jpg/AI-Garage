import { describe, it, expect, vi, beforeEach } from "vitest";
import type Stripe from "stripe";

vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn(async () => ({ success: true, messageId: "m_1" })),
  tenantBookingUrl: vi.fn(() => "https://slug.example/staff/settings/billing"),
}));
vi.mock("@/lib/stripe", () => ({ stripe: { customers: { retrieve: vi.fn() } } }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

const { sendEmail } = await import("@/lib/email");
const { sendServicePlanReceipt } = await import("./subscription-receipts");

// Minimal admin double: returns canned rows keyed by table name. Supports the
// chained select/eq/maybeSingle calls the receipt code makes.
function fakeAdmin(rows: Record<string, unknown>) {
  const make = (table: string) => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: async () => ({ data: rows[table] ?? null }),
    };
    return builder;
  };
  return { from: (table: string) => make(table) } as never;
}

// A service_plan subscription as Stripe would hand it to the webhook.
function servicePlanSub(): Stripe.Subscription {
  return {
    id: "sub_123",
    status: "active",
    metadata: { service_plan_id: "plan_1", customer_id: "cust_1", location_id: "loc_1" },
    items: { data: [{ price: { unit_amount: 1999, recurring: { interval: "month" } } }] },
  } as unknown as Stripe.Subscription;
}

const rows = {
  customers: { full_name: "Jane Driver", email: "jane@example.com" },
  service_plans: { name: "Gold Membership" },
  locations: { name: "Smith Motors", organization: { name: "Smith Motors", logo_url: null, primary_color: "#22c55e" } },
};

beforeEach(() => vi.clearAllMocks());

describe("sendServicePlanReceipt", () => {
  it("emails the receipt to the customer's address", async () => {
    await sendServicePlanReceipt(fakeAdmin(rows), servicePlanSub());

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendEmail).mock.calls[0][0]).toMatchObject({ to: "jane@example.com" });
  });

  it("logs (does not throw) when delivery fails", async () => {
    vi.mocked(sendEmail).mockResolvedValueOnce({ success: false, error: "Resend rejected" });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(sendServicePlanReceipt(fakeAdmin(rows), servicePlanSub())).resolves.toBeUndefined();

    expect(errSpy).toHaveBeenCalledWith(
      "[receipts] service plan: sendEmail failed",
      expect.objectContaining({ sub: "sub_123", to: "jane@example.com", error: "Resend rejected" }),
    );
    errSpy.mockRestore();
  });

  it("skips sending when the customer has no email", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await sendServicePlanReceipt(fakeAdmin({ ...rows, customers: { full_name: "No Email", email: null } }), servicePlanSub());

    expect(sendEmail).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
