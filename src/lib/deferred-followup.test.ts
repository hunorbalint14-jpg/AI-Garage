import { describe, expect, it } from "vitest";
import { dueStage, groupDueRecords, type FollowupRecord } from "./deferred-followup";

const NOW = new Date("2026-07-10T10:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

function record(overrides: Partial<FollowupRecord> & { id: string }): FollowupRecord {
  return {
    customer_id: "cus-1",
    vehicle_id: "veh-1",
    inspection_item_id: null,
    description: "Replace front pads",
    price: 100,
    rag: "amber",
    followup_count: 0,
    last_followup_at: null,
    created_at: daysAgo(20),
    ...overrides,
  };
}

describe("dueStage", () => {
  const offsets = [14, 30];

  it("stage 1 due after 14 days, not before", () => {
    expect(dueStage({ followup_count: 0, created_at: daysAgo(15) }, offsets, NOW)).toBe(1);
    expect(dueStage({ followup_count: 0, created_at: daysAgo(13) }, offsets, NOW)).toBeNull();
  });

  it("stage 2 due after 30 days once stage 1 sent", () => {
    expect(dueStage({ followup_count: 1, created_at: daysAgo(31) }, offsets, NOW)).toBe(2);
    expect(dueStage({ followup_count: 1, created_at: daysAgo(20) }, offsets, NOW)).toBeNull();
  });

  it("exhausted after all stages", () => {
    expect(dueStage({ followup_count: 2, created_at: daysAgo(90) }, offsets, NOW)).toBeNull();
  });

  it("a record that missed windows catches up with a single stage", () => {
    // 60 days old, never followed up → stage 1 (not 1 and 2 in a burst).
    expect(dueStage({ followup_count: 0, created_at: daysAgo(60) }, offsets, NOW)).toBe(1);
  });

  it("ignores invalid offsets", () => {
    expect(dueStage({ followup_count: 0, created_at: daysAgo(50) }, [0, -3, 14], NOW)).toBe(1);
  });
});

describe("groupDueRecords", () => {
  const offsets = [14, 30];

  it("groups due records into one batch per (customer, vehicle)", () => {
    const batches = groupDueRecords(
      [record({ id: "a" }), record({ id: "b", description: "NSF tyre" })],
      offsets,
      new Set(),
      NOW,
    );
    expect(batches).toHaveLength(1);
    expect(batches[0].records.map((r) => r.id).sort()).toEqual(["a", "b"]);
    expect(batches[0].stage).toBe(1);
  });

  it("drops records not yet due", () => {
    const batches = groupDueRecords([record({ id: "a", created_at: daysAgo(3) })], offsets, new Set(), NOW);
    expect(batches).toHaveLength(0);
  });

  it("skips customers followed up within the cap window", () => {
    const batches = groupDueRecords(
      [
        record({ id: "a" }),
        // Same customer, another record nudged 2 days ago → whole customer capped.
        record({ id: "b", description: "Other", followup_count: 1, last_followup_at: daysAgo(2), created_at: daysAgo(40) }),
      ],
      offsets,
      new Set(),
      NOW,
    );
    expect(batches).toHaveLength(0);
  });

  it("skips customers recently contacted by the reminder crons", () => {
    const batches = groupDueRecords([record({ id: "a" })], offsets, new Set(["cus-1"]), NOW);
    expect(batches).toHaveLength(0);
  });

  it("one batch per customer per run — oldest vehicle group wins", () => {
    const batches = groupDueRecords(
      [
        record({ id: "newer", vehicle_id: "veh-2", created_at: daysAgo(15) }),
        record({ id: "older", vehicle_id: "veh-1", created_at: daysAgo(40) }),
      ],
      offsets,
      new Set(),
      NOW,
    );
    expect(batches).toHaveLength(1);
    expect(batches[0].records[0].id).toBe("older");
  });

  it("different customers batch independently", () => {
    const batches = groupDueRecords(
      [record({ id: "a" }), record({ id: "b", customer_id: "cus-2", vehicle_id: "veh-2" })],
      offsets,
      new Set(),
      NOW,
    );
    expect(batches).toHaveLength(2);
  });

  it("ignores records without a customer", () => {
    const batches = groupDueRecords([record({ id: "a", customer_id: null })], offsets, new Set(), NOW);
    expect(batches).toHaveLength(0);
  });
});
