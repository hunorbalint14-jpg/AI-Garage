import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

// The tick used to fan out to request.url's origin — Vercel Cron's protected
// *.vercel.app host — and follow the Deployment Protection redirect to a 200
// login page, so no child route ever ran. These pin the dispatch origin and
// that a failed daily pass shows up in the tick's own run record.

const dispatchCron = vi.fn();
vi.mock("@/lib/cron/dispatch", async () => {
  const actual = await vi.importActual<typeof import("@/lib/cron/dispatch")>("@/lib/cron/dispatch");
  return { ...actual, dispatchCron: (...a: unknown[]) => dispatchCron(...a) };
});
const recordCronRun = vi.fn();
vi.mock("@/lib/platform/cron-runs", () => ({ recordCronRun: (...a: unknown[]) => recordCronRun(...a) }));
vi.mock("@/lib/platform/uptime-maintenance", () => ({ runUptimeMaintenance: vi.fn(async () => {}) }));
vi.mock("@/lib/finance/reconcile", () => ({ reconcileFinanceApplications: vi.fn(async () => {}) }));

const dueTasks: { data: unknown[] } = { data: [] };
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.or = async () => dueTasks;
      chain.update = () => ({ eq: async () => ({ error: null }) });
      return chain;
    },
  }),
}));

import { GET } from "./route";

const SECRET = "test-cron-secret";
function tickRequest(): NextRequest {
  const url = "https://garage-abc123-team.vercel.app/api/cron/tick";
  return { url, headers: new Headers({ authorization: `Bearer ${SECRET}` }) } as unknown as NextRequest;
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", SECRET);
  vi.stubEnv("NEXT_PUBLIC_ROOT_DOMAIN", "ai-garage.co.uk");
  vi.stubEnv("CRON_BASE_URL", "");
  dispatchCron.mockReset();
  recordCronRun.mockReset();
  dueTasks.data = [];
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("cron/tick dispatch", () => {
  it("dispatches per-branch tasks to the public root domain, not the invocation host", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-29T14:00:00Z"));
    dueTasks.data = [
      { id: "t1", location_id: "loc-1", task_type: "mot_reminders", frequency: "daily", hour: 9, day_of_week: null, next_run_at: null },
    ];
    dispatchCron.mockResolvedValue({ ok: true, status: 200 });

    await GET(tickRequest());

    expect(dispatchCron).toHaveBeenCalledTimes(1);
    const [url, secret] = dispatchCron.mock.calls[0];
    expect(url).toBe("https://ai-garage.co.uk/api/cron/reminders?location_id=loc-1&task_type=mot_reminders");
    expect(secret).toBe(SECRET);
  });

  it("runs the four daily passes at 09:00 UTC and records a failed pass as a failed tick", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-29T09:00:04Z"));
    dispatchCron.mockImplementation(async (url: string) =>
      url.endsWith("/api/cron/traffic-rollup")
        ? { ok: false, status: 302, error: "redirected (HTTP 302 → https://vercel.com/sso-api)" }
        : { ok: true, status: 200 },
    );

    const res = await GET(tickRequest());
    const body = await res.json();

    expect(dispatchCron.mock.calls.map((c) => c[0])).toEqual([
      "https://ai-garage.co.uk/api/cron/activation",
      "https://ai-garage.co.uk/api/cron/overage-reconcile",
      "https://ai-garage.co.uk/api/cron/traffic-rollup",
      "https://ai-garage.co.uk/api/cron/accounting-backfill",
    ]);
    expect(body).toMatchObject({ passes: 3, failed: 1 });
    const [, job, ok, , detail] = recordCronRun.mock.calls[0];
    expect(job).toBe("cron/tick");
    expect(ok).toBe(false);
    expect(detail).toContain("failed 1");
    expect(detail).toContain("/api/cron/traffic-rollup: redirected");
  });

  it("doesn't run the daily passes outside 09:00 UTC", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-29T10:00:04Z"));
    await GET(tickRequest());
    expect(dispatchCron).not.toHaveBeenCalled();
  });
});
