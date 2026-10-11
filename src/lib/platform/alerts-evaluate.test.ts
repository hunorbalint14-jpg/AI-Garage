import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// evaluateAlerts: synthetic metrics must breach on consecutive runs before
// anything fires, and auto-declared incidents resolve once their rule clears.

// ── Fakes ───────────────────────────────────────────────────────────────────
const store = new Map<string, number>();
const fakeRedis = {
  incr: vi.fn(async (k: string) => {
    const n = (store.get(k) ?? 0) + 1;
    store.set(k, n);
    return n;
  }),
  del: vi.fn(async (k: string) => {
    store.delete(k);
    return 1;
  }),
  expire: vi.fn(async () => 1),
};
const redisHolder: { value: typeof fakeRedis | null } = { value: fakeRedis };
vi.mock("@/lib/redis", () => ({
  get redis() {
    return redisHolder.value;
  },
}));

const sendEmailBatch = vi.fn(async (list: unknown[]) => list.map(() => ({ success: true })));
vi.mock("@/lib/email", () => ({ sendEmailBatch: (list: unknown[]) => sendEmailBatch(list) }));
vi.mock("@/lib/platform/services", () => ({ fetchDbHealth: vi.fn(async () => null) }));
vi.mock("@/lib/platform/webhooks", () => ({ recentWebhookFailureRate: vi.fn(async () => null) }));
vi.mock("@/lib/platform/sentry", () => ({ readSentrySnapshot: vi.fn(async () => null) }));
vi.mock("@/lib/platform/cron-runs", () => ({ fetchStaleCronJobs: vi.fn(async () => []) }));

type Row = Record<string, unknown>;
const db = {
  rules: [] as Row[],
  openIncident: null as Row | null,
  prevRun: null as Row[] | null, // null = the uptime_checks read errors
  writes: [] as { table: string; op: string; row: Row }[],
};

// Minimal chainable query builder: records writes, answers reads per table.
function table(name: string) {
  let op = "select";
  let payload: Row = {};
  const result = () => {
    if (name === "alert_rules" && op === "select") return { data: db.rules, error: null };
    if (name === "incidents" && op === "select") return { data: db.openIncident, error: null };
    if (name === "incidents" && op === "insert") return { data: { id: "inc-new" }, error: null };
    if (name === "uptime_checks" && op === "select")
      return db.prevRun ? { data: db.prevRun, error: null } : { data: null, error: { message: "db down" } };
    return { data: null, error: null };
  };
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "lt", "gte", "order", "limit"]) {
    chain[m] = () => chain;
  }
  chain.insert = (row: Row) => {
    op = "insert";
    payload = row;
    db.writes.push({ table: name, op, row });
    return chain;
  };
  chain.update = (row: Row) => {
    op = "update";
    payload = row;
    db.writes.push({ table: name, op, row: payload });
    return chain;
  };
  chain.single = async () => result();
  chain.maybeSingle = async () => result();
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve);
  return chain;
}
const admin = { from: (name: string) => table(name) } as never;

import { clearedLongEnough, confirmationsRequired, evaluateAlerts, isConfirmed } from "./alerts";

const AVAILABILITY = {
  id: "ar-availability",
  name: "API availability < SLO",
  metric: "availability_pct",
  operator: "<",
  threshold: 99.9,
  window_secs: 300,
  source: "Synthetic",
  severity: "SEV-2",
  auto_declare: true,
  channels: ["email"],
  enabled: true,
  last_fired_at: null as string | null,
  last_delivery: null,
};
const bad = [{ ok: true, latency_ms: 100 }, { ok: false, latency_ms: 5500 }];
const good = [{ ok: true, latency_ms: 100 }, { ok: true, latency_ms: 120 }];

beforeEach(() => {
  store.clear();
  redisHolder.value = fakeRedis;
  db.rules = [{ ...AVAILABILITY }];
  db.openIncident = null;
  db.prevRun = [];
  db.writes = [];
  sendEmailBatch.mockClear();
  vi.stubEnv("PLATFORM_SUPPORT_EMAIL", "ops@example.test");
  vi.stubEnv("SLACK_OPS_WEBHOOK_URL", "");
});
afterEach(() => vi.unstubAllEnvs());

const incidentInserts = () => db.writes.filter((w) => w.table === "incidents" && w.op === "insert");

describe("confirmation rules", () => {
  it("needs two runs for synthetic metrics, one for everything else", () => {
    expect(confirmationsRequired("availability_pct")).toBe(2);
    expect(confirmationsRequired("p95_ms")).toBe(2);
    expect(confirmationsRequired("cron_stale_mins")).toBe(1);
    expect(confirmationsRequired("db_pool_pct")).toBe(1);
  });

  it("confirms on the streak, falls back to the previous run, and fails open when both are unknown", () => {
    expect(isConfirmed(2, 1, null)).toBe(false);
    expect(isConfirmed(2, 2, null)).toBe(true);
    expect(isConfirmed(2, null, false)).toBe(false);
    expect(isConfirmed(2, null, true)).toBe(true);
    expect(isConfirmed(2, null, null)).toBe(true);
    expect(isConfirmed(1, 0, false)).toBe(true);
  });

  it("only counts a rule as cleared a full window after it last fired", () => {
    const now = Date.parse("2026-09-29T13:00:00Z");
    expect(clearedLongEnough({ last_fired_at: null, window_secs: 300 }, now)).toBe(true);
    expect(clearedLongEnough({ last_fired_at: "2026-09-29T12:57:00Z", window_secs: 300 }, now)).toBe(false);
    expect(clearedLongEnough({ last_fired_at: "2026-09-29T12:55:00Z", window_secs: 300 }, now)).toBe(true);
  });
});

describe("evaluateAlerts — consecutive-run confirmation", () => {
  it("stays quiet on a single bad run (the 29 Sep blip)", async () => {
    const r = await evaluateAlerts(admin, bad);
    expect(r).toEqual({ opened: 0, resolved: 0 });
    expect(sendEmailBatch).not.toHaveBeenCalled();
    expect(incidentInserts()).toHaveLength(0);
  });

  it("fires and declares on the second consecutive bad run", async () => {
    await evaluateAlerts(admin, bad);
    const r = await evaluateAlerts(admin, bad);
    expect(r.opened).toBe(1);
    expect(sendEmailBatch).toHaveBeenCalledTimes(1);
    const mail = (sendEmailBatch.mock.calls[0][0] as { text: string }[])[0];
    expect(mail.text).toContain("2 consecutive runs");
    expect(incidentInserts()).toHaveLength(1);
  });

  it("a good run in between resets the streak", async () => {
    await evaluateAlerts(admin, bad);
    await evaluateAlerts(admin, good);
    await evaluateAlerts(admin, bad);
    expect(sendEmailBatch).not.toHaveBeenCalled();
  });

  it("keeps golden-path's streak separate from uptime's", async () => {
    await evaluateAlerts(admin, bad, { source: "uptime" });
    await evaluateAlerts(admin, bad, { source: "golden-path" });
    expect(sendEmailBatch).not.toHaveBeenCalled();
  });

  it("without Redis, confirms against the previous run in uptime_checks", async () => {
    redisHolder.value = null;
    db.prevRun = [{ ok: true, latency_ms: 90, checked_at: "t1" }, { ok: true, latency_ms: 95, checked_at: "t1" }];
    await evaluateAlerts(admin, bad);
    expect(sendEmailBatch).not.toHaveBeenCalled();

    db.prevRun = [{ ok: false, latency_ms: null, checked_at: "t2" }, { ok: true, latency_ms: 95, checked_at: "t2" }];
    await evaluateAlerts(admin, bad);
    expect(sendEmailBatch).toHaveBeenCalledTimes(1);
  });

  it("fails open when neither Redis nor the database can answer", async () => {
    redisHolder.value = null;
    db.prevRun = null;
    await evaluateAlerts(admin, bad);
    expect(sendEmailBatch).toHaveBeenCalledTimes(1);
  });
});

describe("evaluateAlerts — auto-resolve", () => {
  const openInc = { id: "inc-1", ref: "INC-12345-ABC" };

  it("resolves an unpublished auto-declared incident once the rule has been clear for a window", async () => {
    db.rules = [{ ...AVAILABILITY, last_fired_at: new Date(Date.now() - 10 * 60_000).toISOString() }];
    db.openIncident = openInc;
    const r = await evaluateAlerts(admin, good);
    expect(r.resolved).toBe(1);
    const update = db.writes.find((w) => w.table === "incidents" && w.op === "update");
    expect(update?.row).toMatchObject({ status: "Resolved" });
    const note = db.writes.find((w) => w.table === "incident_updates");
    expect(note?.row).toMatchObject({ status: "Resolved", public: false });
    const mail = (sendEmailBatch.mock.calls[0][0] as { subject: string }[])[0];
    expect(mail.subject).toBe("[RESOLVED] API availability < SLO");
  });

  it("waits out the window after the last firing (no resolve/re-declare flapping)", async () => {
    db.rules = [{ ...AVAILABILITY, last_fired_at: new Date(Date.now() - 60_000).toISOString() }];
    db.openIncident = openInc;
    const r = await evaluateAlerts(admin, good);
    expect(r.resolved).toBe(0);
    expect(db.writes.filter((w) => w.table === "incidents")).toHaveLength(0);
  });

  it("never resolves from golden-path's partial view", async () => {
    db.openIncident = openInc;
    const r = await evaluateAlerts(admin, good, { source: "golden-path" });
    expect(r.resolved).toBe(0);
  });

  it("does nothing when there's no open incident", async () => {
    const r = await evaluateAlerts(admin, good);
    expect(r.resolved).toBe(0);
    expect(sendEmailBatch).not.toHaveBeenCalled();
  });
});
