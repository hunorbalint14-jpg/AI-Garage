import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})) }));
vi.mock("@/lib/platform/cron-runs", () => ({ recordCronRun: vi.fn() }));
vi.mock("@/lib/stripe", () => ({ stripe: {} }));
vi.mock("@/lib/tenant-overage", () => ({
  OVERAGE_PRICE_ENV: "STRIPE_TENANT_PRICE_GROWTH_OVERAGE",
  syncLocationOverage: vi.fn(),
}));

const { recordCronRun } = await import("@/lib/platform/cron-runs");
const { syncLocationOverage } = await import("@/lib/tenant-overage");
const { GET } = await import("./route");

const request = () =>
  new Request("https://ai-garage.co.uk/api/cron/overage-reconcile", {
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
  }) as never;

describe("cron/overage-reconcile", () => {
  const saved = process.env.STRIPE_TENANT_PRICE_GROWTH_OVERAGE;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.STRIPE_TENANT_PRICE_GROWTH_OVERAGE;
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.STRIPE_TENANT_PRICE_GROWTH_OVERAGE;
    else process.env.STRIPE_TENANT_PRICE_GROWTH_OVERAGE = saved;
  });

  it("records a run when no overage price is configured — /admin/health watches it for a missing daily run", async () => {
    const res = await GET(request());

    await expect(res.json()).resolves.toEqual({ success: true, skipped: "no_price_configured" });
    expect(syncLocationOverage).not.toHaveBeenCalled();
    expect(recordCronRun).toHaveBeenCalledWith(
      expect.anything(),
      "cron/overage-reconcile",
      true,
      expect.any(Number),
      "skipped: STRIPE_TENANT_PRICE_GROWTH_OVERAGE unset",
    );
  });
});
