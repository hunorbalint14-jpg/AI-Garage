import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})) }));
vi.mock("@/lib/platform/cron-runs", () => ({ recordCronRun: vi.fn() }));
vi.mock("@/lib/trial-ending-emails", () => ({ runTrialEndingSweep: vi.fn() }));

const { recordCronRun } = await import("@/lib/platform/cron-runs");
const { runTrialEndingSweep } = await import("@/lib/trial-ending-emails");
const { GET } = await import("./route");

const request = (auth = `Bearer ${process.env.CRON_SECRET}`) =>
  new Request("https://ai-garage.co.uk/api/cron/trial-ending", { headers: { authorization: auth } }) as never;

describe("cron/trial-ending", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects a missing / wrong secret", async () => {
    const res = await GET(request("Bearer nope"));
    expect(res.status).toBe(401);
    expect(runTrialEndingSweep).not.toHaveBeenCalled();
  });

  it("records a green run even when nothing was due — /admin/health watches it daily", async () => {
    vi.mocked(runTrialEndingSweep).mockResolvedValue({ checked: 0, sent: 0, skipped: 0, errors: [] });
    await GET(request());
    expect(recordCronRun).toHaveBeenCalledWith(expect.anything(), "cron/trial-ending", true, expect.any(Number), "sent 0, skipped 0, checked 0");
  });

  it("records a failed run with the first error", async () => {
    vi.mocked(runTrialEndingSweep).mockResolvedValue({ checked: 2, sent: 1, skipped: 0, errors: ["smith-motors: resend down"] });
    await GET(request());
    expect(recordCronRun).toHaveBeenCalledWith(
      expect.anything(),
      "cron/trial-ending",
      false,
      expect.any(Number),
      "sent 1, skipped 0, checked 2 — smith-motors: resend down",
    );
  });
});
