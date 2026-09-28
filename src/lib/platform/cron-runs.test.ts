import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { staleCronJobs, KNOWN_JOBS, type CronJob } from "./cron-runs";

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

  it("tolerates one missed day for the tick's daily platform passes, alerts on the second", () => {
    // Fired only by the 09:00 UTC tick; a missed hour runs the next day by design.
    expect(staleCronJobs([job("cron/activation", minsAgo(47 * 60))], NOW)).toEqual([]);
    expect(staleCronJobs([job("cron/activation", minsAgo(51 * 60))], NOW)).toHaveLength(1);
  });
});

// /admin/health only shows jobs listed in the registry: an unlisted job's runs
// are recorded and then never displayed or stale-checked. Seven jobs once ran
// that way, including the nightly MOT sync and the golden-path money-path
// check. These tests read the source so a new cron can't repeat it.
describe("cron registry lockstep", () => {
  const repo = process.cwd();
  const cronDir = path.join(repo, "src/app/api/cron");
  const isWatched = (name: string) => staleCronJobs([job(name, null)], NOW).length === 1;

  function routeSources(): { file: string; src: string }[] {
    const out: { file: string; src: string }[] = [];
    for (const dir of readdirSync(cronDir, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const file = path.join(cronDir, dir.name, "route.ts");
      try {
        out.push({ file: path.relative(repo, file), src: readFileSync(file, "utf8") });
      } catch {
        // directory without a route.ts
      }
    }
    return out;
  }

  const LITERAL_CALL = /recordCronRun\(\s*[^,]+,\s*"([^"]+)"/g;

  it("names the job with a string literal in every recordCronRun() call, so these checks can see it", () => {
    for (const { file, src } of routeSources()) {
      const calls = src.match(/recordCronRun\(/g)?.length ?? 0;
      const literals = [...src.matchAll(LITERAL_CALL)].length;
      expect(literals, `${file}: ${calls - literals} recordCronRun() call(s) with a non-literal job name`).toBe(calls);
    }
  });

  it("registers every job a cron route records", () => {
    const recorded = new Set(routeSources().flatMap(({ src }) => [...src.matchAll(LITERAL_CALL)].map((m) => m[1])));
    expect(recorded.size).toBeGreaterThan(10); // the scan itself found the routes
    expect([...recorded].filter((name) => !KNOWN_JOBS.includes(name)).sort()).toEqual([]);
  });

  it("watches every Vercel-scheduled cron", () => {
    const vercel = JSON.parse(readFileSync(path.join(repo, "vercel.json"), "utf8")) as { crons: { path: string }[] };
    const names = vercel.crons.map((c) => c.path.replace(/^\/api\//, ""));
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((n) => !isWatched(n))).toEqual([]);
  });

  it("watches every daily platform pass the tick fires", () => {
    const tick = readFileSync(path.join(cronDir, "tick/route.ts"), "utf8");
    const list = tick.match(/for \(const path of \[([^\]]+)\]\)/);
    expect(list, "couldn't find the tick's daily-pass list — update this test with the tick").not.toBeNull();
    const names = [...list![1].matchAll(/"\/api\/(cron\/[a-z-]+)"/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((n) => !isWatched(n))).toEqual([]);
  });
});
