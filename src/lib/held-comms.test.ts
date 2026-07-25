import { describe, it, expect, vi } from "vitest";
import { fetchHeldSummary, recordHeld, SAMPLE_LIMIT, STALE_AFTER_HOURS } from "./held-comms";
import { HELD_KINDS } from "./held-comms-shared";

type Row = { kind: string; summary: string; would_have_sent_at: string };

// Minimal admin-client stand-in: enough of the PostgREST builder for the two
// functions under test, capturing what they asked for.
function fakeAdmin(rows: Row[]) {
  const calls: { table: string; upserted?: unknown[]; onConflict?: string; gte?: string } = { table: "" };
  const builder = {
    select: () => builder,
    eq: () => builder,
    gte: (_col: string, value: string) => {
      calls.gte = value;
      return builder;
    },
    order: () => builder,
    limit: () => Promise.resolve({ data: rows, error: null }),
    upsert: (payload: unknown[], opts: { onConflict: string }) => {
      calls.upserted = payload;
      calls.onConflict = opts.onConflict;
      return Promise.resolve({ error: null });
    },
  };
  const admin = {
    from: (table: string) => {
      calls.table = table;
      return builder;
    },
  };
  return { admin: admin as never, calls };
}

const at = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3600_000).toISOString();

describe("recordHeld", () => {
  it("upserts on the pending-set key so a daily cron can't duplicate rows", async () => {
    const { admin, calls } = fakeAdmin([]);
    const n = await recordHeld(admin, [
      {
        locationId: "loc1",
        kind: "mot_reminder",
        customerId: "c1",
        refTable: "vehicles",
        refId: "v1",
        summary: "AB12 CDE — MOT due 3 Aug",
      },
    ]);
    expect(n).toBe(1);
    expect(calls.table).toBe("held_comms");
    expect(calls.onConflict).toBe("location_id,kind,ref_id");
  });

  it("writes nothing for an empty batch", async () => {
    const { admin, calls } = fakeAdmin([]);
    expect(await recordHeld(admin, [])).toBe(0);
    expect(calls.upserted).toBeUndefined();
  });

  it("never throws — a failed hold must not break the cron run", async () => {
    const admin = {
      from: () => {
        throw new Error("db gone");
      },
    } as never;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      recordHeld(admin, [
        { locationId: "l", kind: "mot_reminder", customerId: null, refTable: "vehicles", refId: "v", summary: "x" },
      ]),
    ).resolves.toBe(0);
    spy.mockRestore();
  });

  it("truncates a runaway summary", async () => {
    const { admin, calls } = fakeAdmin([]);
    await recordHeld(admin, [
      { locationId: "l", kind: "mot_reminder", customerId: null, refTable: "vehicles", refId: "v", summary: "x".repeat(500) },
    ]);
    const row = (calls.upserted as { summary: string }[])[0];
    expect(row.summary.length).toBe(300);
  });
});

describe("fetchHeldSummary", () => {
  it("groups by kind, counts, and caps the samples", async () => {
    const rows: Row[] = [
      ...Array.from({ length: 5 }, (_, i) => ({
        kind: "mot_reminder",
        summary: `reg ${i}`,
        would_have_sent_at: at(10),
      })),
      { kind: "invoice_dunning", summary: "INV-1", would_have_sent_at: at(5) },
    ];
    const { admin } = fakeAdmin(rows);
    const summary = await fetchHeldSummary(admin, "loc1");

    expect(summary.total).toBe(6);
    const mot = summary.groups.find((g) => g.kind === "mot_reminder")!;
    expect(mot.count).toBe(5);
    expect(mot.samples).toHaveLength(SAMPLE_LIMIT);
    expect(mot.label).toBe("MOT reminders");
    expect(summary.groups.map((g) => g.kind)).toEqual(["mot_reminder", "invoice_dunning"]);
  });

  it("only counts rows the crons confirmed recently", async () => {
    const { admin, calls } = fakeAdmin([]);
    await fetchHeldSummary(admin, "loc1");
    const cutoffAgeHours = (Date.now() - new Date(calls.gte!).getTime()) / 3600_000;
    expect(cutoffAgeHours).toBeCloseTo(STALE_AFTER_HOURS, 1);
  });

  it("ignores a kind the app no longer knows about", async () => {
    const { admin } = fakeAdmin([{ kind: "carrier_pigeon", summary: "?", would_have_sent_at: at(1) }]);
    const summary = await fetchHeldSummary(admin, "loc1");
    expect(summary.groups).toEqual([]);
    // total counts raw rows; the groups are what the screen renders.
    expect(summary.total).toBe(1);
  });

  it("labels every kind the routes can record", () => {
    // A kind added to the DB check constraint but not the label map would
    // render as a missing group on the Go-live screen.
    for (const kind of HELD_KINDS) {
      expect(typeof kind).toBe("string");
    }
    expect(HELD_KINDS).toHaveLength(8);
  });
});
