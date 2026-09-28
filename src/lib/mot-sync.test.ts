import { describe, it, expect } from "vitest";
import type { DeltaVehicleUpdate } from "./dvsa-bulk";
import { diffMotUpdate, findMotedElsewhere, type MotVehicleRow, type PendingMotUpdate } from "./mot-sync";

const vehicle = (over: Partial<MotVehicleRow> = {}): MotVehicleRow => ({
  id: "veh-1",
  location_id: "loc-1",
  organization_id: "org-1",
  registration: "AB12 CDE",
  mot_expiry: "2026-07-25",
  last_mot_test_date: "2025-07-20",
  created_at: "2025-01-10T09:00:00.000Z",
  ...over,
});

const update = (over: Partial<DeltaVehicleUpdate> = {}): DeltaVehicleUpdate => ({
  registration: "AB12CDE",
  normalizedReg: "AB12CDE",
  modification: null,
  motExpiry: "2027-06-19",
  lastTestDate: "2026-06-20",
  tests: [],
  ...over,
});

// Minimal admin stand-in for the bookings/jobs lookups: every builder method
// chains, and awaiting it yields that table's rows.
function fakeAdmin(rows: { bookings?: object[]; jobs?: object[] } = {}) {
  const tablesQueried: string[] = [];
  const admin = {
    from(table: "bookings" | "jobs") {
      tablesQueried.push(table);
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "in", "gte"]) chain[m] = () => chain;
      chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: rows[table] ?? [], error: null });
      return chain;
    },
  };
  return { admin: admin as never, tablesQueried };
}

describe("diffMotUpdate", () => {
  it("returns nothing when DVSA agrees with what we store", () => {
    const v = vehicle({ mot_expiry: "2027-06-19", last_mot_test_date: "2026-06-20" });
    expect(diffMotUpdate(update(), v)).toBeNull();
  });

  it("picks up a newer test and its expiry", () => {
    expect(diffMotUpdate(update(), vehicle())).toMatchObject({
      motExpiry: "2027-06-19",
      lastTestDate: "2026-06-20",
      newTest: true,
    });
  });

  it("treats any test as new for a vehicle with no stored test date (imports)", () => {
    expect(diffMotUpdate(update(), vehicle({ last_mot_test_date: null }))?.newTest).toBe(true);
  });

  it("corrects the expiry without calling it a new test when the test date is unchanged", () => {
    const v = vehicle({ mot_expiry: "2027-01-01", last_mot_test_date: "2026-06-20" });
    expect(diffMotUpdate(update(), v)).toMatchObject({ motExpiry: "2027-06-19", newTest: false });
  });
});

describe("findMotedElsewhere", () => {
  const pending = (v: MotVehicleRow, over: Partial<PendingMotUpdate> = {}): PendingMotUpdate => ({
    vehicle: v,
    motExpiry: "2027-06-19",
    lastTestDate: "2026-06-20",
    newTest: true,
    ...over,
  });

  it("flags a test with no booking or job here around it", async () => {
    const { admin } = fakeAdmin();
    const flagged = await findMotedElsewhere(admin, [pending(vehicle())]);
    expect([...flagged]).toEqual(["veh-1"]);
  });

  it("does not flag when a booking falls inside the ±7 day window", async () => {
    const { admin } = fakeAdmin({ bookings: [{ vehicle_id: "veh-1", scheduled_at: "2026-06-18T09:00:00Z" }] });
    expect((await findMotedElsewhere(admin, [pending(vehicle())])).size).toBe(0);
  });

  it("still flags when the only activity is outside the window", async () => {
    const { admin } = fakeAdmin({ jobs: [{ vehicle_id: "veh-1", created_at: "2026-05-01T09:00:00Z" }] });
    expect((await findMotedElsewhere(admin, [pending(vehicle())])).size).toBe(1);
  });

  it("never flags a test taken before the vehicle entered our system", async () => {
    // An imported car: its last MOT happened before it was in the app, so a
    // missing booking/job proves nothing — it was very likely done here.
    const { admin, tablesQueried } = fakeAdmin();
    const imported = vehicle({ created_at: "2026-08-01T10:00:00.000Z", last_mot_test_date: null });
    const flagged = await findMotedElsewhere(admin, [pending(imported)]);
    expect(flagged.size).toBe(0);
    expect(tablesQueried).toEqual([]); // nothing left to judge, so no lookups
  });

  it("judges a test on the same day the vehicle was added", async () => {
    const { admin } = fakeAdmin();
    const addedThatDay = vehicle({ created_at: "2026-06-20T16:30:00.000Z" });
    expect((await findMotedElsewhere(admin, [pending(addedThatDay)])).size).toBe(1);
  });

  it("ignores updates that only corrected the expiry", async () => {
    const { admin } = fakeAdmin();
    expect((await findMotedElsewhere(admin, [pending(vehicle(), { newTest: false })])).size).toBe(0);
  });
});
