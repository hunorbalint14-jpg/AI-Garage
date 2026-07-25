import { describe, it, expect } from "vitest";
import { staleCronJobs, type CronJob } from "./cron-runs";

const NOW = new Date("2026-07-25T12:00:00Z");
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

const job = (name: string, lastRunAt: string | null): CronJob => ({
  job: name,
  schedule: "test",
  ok: true,
  lastRunAt,
  durationMs: 10,
  detail: null,
});

describe("staleCronJobs", () => {
  it("reports nothing while the watched jobs are running to schedule", () => {
    expect(
      staleCronJobs(
        [
          job("cron/tick", minsAgo(20)),
          job("cron/uptime", minsAgo(3)),
          job("cron/quote-expiry", minsAgo(25)),
        ],
        NOW,
      ),
    ).toEqual([]);
  });

  it("flags a job that stopped, with how far past its allowance it is", () => {
    const stale = staleCronJobs([job("cron/tick", minsAgo(200)), job("cron/uptime", minsAgo(2))], NOW);
    expect(stale).toHaveLength(1);
    expect(stale[0]).toMatchObject({ job: "cron/tick", ageMins: 200, maxMins: 90, overdueMins: 110 });
  });

  it("treats a job that has never run as stale", () => {
    const stale = staleCronJobs([job("cron/uptime", null)], NOW);
    expect(stale[0].job).toBe("cron/uptime");
    expect(stale[0].overdueMins).toBeGreaterThan(0);
  });

  it("ignores the via-tick jobs — a quiet day is normal for them", () => {
    expect(
      staleCronJobs(
        [
          job("cron/reminders", minsAgo(60 * 72)),
          job("cron/dunning", null),
          job("cron/uptime", minsAgo(1)),
        ],
        NOW,
      ),
    ).toEqual([]);
  });

  it("orders worst first, so the alert names the most broken job", () => {
    const stale = staleCronJobs(
      [
        job("cron/quote-expiry", minsAgo(120)), // 30 over
        job("cron/tick", minsAgo(400)), // 310 over
        job("cron/uptime", minsAgo(60)), // 40 over
      ],
      NOW,
    );
    expect(stale.map((s) => s.job)).toEqual(["cron/tick", "cron/uptime", "cron/quote-expiry"]);
  });

  it("is exclusive at the boundary — exactly at the allowance is still healthy", () => {
    expect(staleCronJobs([job("cron/tick", minsAgo(90))], NOW)).toEqual([]);
    expect(staleCronJobs([job("cron/tick", minsAgo(91))], NOW)).toHaveLength(1);
  });
});
