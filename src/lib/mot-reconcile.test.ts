import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DvsaRecordResult } from "./dvla";

vi.mock("@/lib/dvla", () => ({ fetchDvsaVehicleRecord: vi.fn() }));
vi.mock("@/lib/mot-history", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mot-history")>()),
  persistMotTests: vi.fn(async (_admin: unknown, rows: unknown[]) => ({ upserted: rows.length, failed: 0, error: null })),
}));

const { fetchDvsaVehicleRecord } = await import("@/lib/dvla");
const { reconcileStaleMotExpiries, LOOKAHEAD_DAYS, RECHECK_AFTER_DAYS } = await import("./mot-reconcile");
const fetchRecord = vi.mocked(fetchDvsaVehicleRecord);

const NOW = new Date("2026-09-28T04:15:00.000Z");
const NOW_ISO = NOW.toISOString();

type Row = Record<string, unknown>;

// Records every builder call. Awaiting a read yields the table's rows;
// awaiting an update records it and succeeds.
function fakeAdmin(tables: { vehicles?: Row[]; bookings?: Row[]; jobs?: Row[] }) {
  const updates: { patch: Row; eq?: unknown; in?: unknown }[] = [];
  const reads: { table: string; calls: [string, unknown[]][] }[] = [];
  const admin = {
    from(table: keyof typeof tables) {
      const calls: [string, unknown[]][] = [];
      let patch: Row | null = null;
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "or", "not", "order", "limit", "in", "gte", "eq"]) {
        chain[m] = (...args: unknown[]) => {
          calls.push([m, args]);
          return chain;
        };
      }
      chain.update = (p: Row) => {
        patch = p;
        return chain;
      };
      chain.then = (resolve: (v: unknown) => unknown) => {
        if (patch) {
          const arg = (name: string) => calls.find(([m]) => m === name)?.[1];
          updates.push({ patch, eq: arg("eq"), in: arg("in") });
          return resolve({ error: null });
        }
        reads.push({ table, calls });
        return resolve({ data: tables[table] ?? [], error: null });
      };
      return chain;
    },
  };
  return { admin: admin as never, updates, reads };
}

const vehicleRow = (over: Row = {}): Row => ({
  id: "veh-1",
  location_id: "loc-1",
  organization_id: "org-1",
  registration: "AB12 CDE",
  // Stored as expired 65 days ago...
  mot_expiry: "2026-07-25",
  last_mot_test_date: "2025-07-20",
  created_at: "2025-01-10T09:00:00.000Z",
  ...over,
});

// ...but DVSA shows it passed elsewhere in June.
const passedInJune = (registration = "AB12CDE"): DvsaRecordResult => ({
  status: "ok",
  record: {
    registration,
    motTests: [
      { completedDate: "2026-06-20T10:00:00.000Z", testResult: "PASSED", expiryDate: "2027-06-19", odometerValue: "61000", odometerUnit: "MI" },
      { completedDate: "2025-07-20T10:00:00.000Z", testResult: "PASSED", expiryDate: "2026-07-25", odometerValue: "52000", odometerUnit: "MI" },
    ],
  },
});

beforeEach(() => {
  fetchRecord.mockReset();
});

describe("reconcileStaleMotExpiries", () => {
  it("corrects a car shown as overdue that was MOT'd elsewhere, and flags it for win-back", async () => {
    fetchRecord.mockResolvedValue(passedInJune());
    const { admin, updates } = fakeAdmin({ vehicles: [vehicleRow()] });

    const r = await reconcileStaleMotExpiries(admin, { now: NOW });

    expect(r).toMatchObject({ candidates: 1, checked: 1, updated: 1, elsewhere: 1, failed: false });
    expect(updates).toContainEqual({
      patch: {
        mot_synced_at: NOW_ISO,
        mot_expiry: "2027-06-19",
        last_mot_test_date: "2026-06-20",
        moted_elsewhere_at: NOW_ISO,
      },
      eq: ["id", "veh-1"],
      in: undefined,
    });
  });

  it("corrects an imported car's expiry without flagging a test from before the import", async () => {
    fetchRecord.mockResolvedValue(passedInJune());
    const imported = vehicleRow({ created_at: "2026-08-01T10:00:00.000Z", last_mot_test_date: null });
    const { admin, updates } = fakeAdmin({ vehicles: [imported] });

    const r = await reconcileStaleMotExpiries(admin, { now: NOW });

    expect(r.elsewhere).toBe(0);
    expect(updates[0].patch).toEqual({
      mot_synced_at: NOW_ISO,
      mot_expiry: "2027-06-19",
      last_mot_test_date: "2026-06-20",
    });
  });

  it("looks a registration up once when it's on the books at two orgs", async () => {
    fetchRecord.mockResolvedValue(passedInJune());
    const { admin, updates } = fakeAdmin({
      vehicles: [vehicleRow(), vehicleRow({ id: "veh-2", organization_id: "org-2", registration: "ab12cde" })],
    });

    const r = await reconcileStaleMotExpiries(admin, { now: NOW });

    expect(fetchRecord).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ candidates: 1, updated: 2 });
    expect(updates.map((u) => u.eq)).toEqual([["id", "veh-1"], ["id", "veh-2"]]);
  });

  it("stamps a vehicle DVSA confirms unchanged, so it waits for the recheck window", async () => {
    // Genuinely lapsed: DVSA's latest pass is the one we already have.
    fetchRecord.mockResolvedValue({
      status: "ok",
      record: { registration: "AB12CDE", motTests: [{ completedDate: "2025-07-20T10:00:00Z", testResult: "PASSED", expiryDate: "2026-07-25" }] },
    });
    const { admin, updates } = fakeAdmin({ vehicles: [vehicleRow()] });

    const r = await reconcileStaleMotExpiries(admin, { now: NOW });

    expect(r).toMatchObject({ checked: 1, updated: 0 });
    expect(updates).toEqual([{ patch: { mot_synced_at: NOW_ISO }, eq: undefined, in: ["id", ["veh-1"]] }]);
  });

  it("stamps a registration DVSA doesn't know", async () => {
    fetchRecord.mockResolvedValue({ status: "not_found" });
    const { admin, updates } = fakeAdmin({ vehicles: [vehicleRow()] });

    const r = await reconcileStaleMotExpiries(admin, { now: NOW });

    expect(r).toMatchObject({ checked: 1, notFound: 1, updated: 0 });
    expect(updates[0]).toMatchObject({ patch: { mot_synced_at: NOW_ISO }, in: ["id", ["veh-1"]] });
  });

  it("leaves a per-registration error unstamped so the next run retries it", async () => {
    fetchRecord.mockResolvedValue({ status: "error", error: "DVSA API error (503): busy" });
    const { admin, updates } = fakeAdmin({ vehicles: [vehicleRow()] });

    const r = await reconcileStaleMotExpiries(admin, { now: NOW });

    expect(r).toMatchObject({ checked: 0, errors: 1, failed: false });
    expect(updates).toEqual([]);
  });

  it("stops on a systemic failure and reports it, keeping what the batch already fetched", async () => {
    const regs = ["AA11AAA", "BB22BBB", "CC33CCC", "DD44DDD", "EE55EEE"];
    fetchRecord.mockImplementation(async (reg: string) =>
      reg === "BB22BBB" ? { status: "systemic", error: "DVSA API key not configured." } : passedInJune(reg),
    );
    const { admin, updates } = fakeAdmin({
      vehicles: regs.map((reg, i) => vehicleRow({ id: `veh-${i}`, registration: reg })),
    });

    const r = await reconcileStaleMotExpiries(admin, { now: NOW });

    // First batch of 4 completes; the 5th is never attempted.
    expect(fetchRecord).toHaveBeenCalledTimes(4);
    expect(r).toMatchObject({ failed: true, stoppedEarly: "DVSA API key not configured.", updated: 3 });
    expect(updates.map((u) => u.eq)).toEqual([["id", "veh-0"], ["id", "veh-2"], ["id", "veh-3"]]);
  });

  it("selects expired, due-soon and missing expiries not checked inside the recheck window", async () => {
    const { admin, reads } = fakeAdmin({ vehicles: [] });

    await reconcileStaleMotExpiries(admin, { now: NOW });

    const ors = reads.find((q) => q.table === "vehicles")!.calls.filter(([m]) => m === "or").map(([, a]) => a[0]);
    const dueBy = new Date(NOW);
    dueBy.setUTCDate(dueBy.getUTCDate() + LOOKAHEAD_DAYS);
    const recheck = new Date(NOW);
    recheck.setUTCDate(recheck.getUTCDate() - RECHECK_AFTER_DAYS);
    expect(ors).toEqual([
      `mot_expiry.is.null,mot_expiry.lte.${dueBy.toISOString().slice(0, 10)}`,
      `mot_synced_at.is.null,mot_synced_at.lt.${recheck.toISOString().slice(0, 10)}`,
    ]);
  });
});
