import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})) }));
vi.mock("@/lib/platform/cron-runs", () => ({ recordCronRun: vi.fn() }));
vi.mock("@/lib/feature-flags", () => ({ isFeatureEnabled: vi.fn() }));
vi.mock("@/lib/activation-emails", () => ({
  runActivationSweep: vi.fn(async () => ({ sent: 2, stopped: 0, checked: 5, errors: [] })),
}));

const { recordCronRun } = await import("@/lib/platform/cron-runs");
const { isFeatureEnabled } = await import("@/lib/feature-flags");
const { runActivationSweep } = await import("@/lib/activation-emails");
const { GET } = await import("./route");

const request = () =>
  new Request("https://ai-garage.co.uk/api/cron/activation", {
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
  }) as never;

describe("cron/activation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("records a run even when the flag is off — /admin/health watches it for a missing daily run", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(false);

    const res = await GET(request());

    await expect(res.json()).resolves.toEqual({ success: true, skipped: "flag_off" });
    expect(runActivationSweep).not.toHaveBeenCalled();
    expect(recordCronRun).toHaveBeenCalledWith(
      expect.anything(),
      "cron/activation",
      true,
      expect.any(Number),
      "skipped: activation_emails flag off",
    );
  });

  it("runs the sweep and records it when the flag is on", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(true);

    await GET(request());

    expect(runActivationSweep).toHaveBeenCalledOnce();
    expect(recordCronRun).toHaveBeenCalledWith(
      expect.anything(),
      "cron/activation",
      true,
      expect.any(Number),
      "sent 2, stopped 0, checked 5",
    );
  });
});
