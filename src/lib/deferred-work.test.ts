import { describe, expect, it } from "vitest";
import { planBankUpserts, type BankCandidate } from "./deferred-work";

function candidate(overrides: Partial<BankCandidate> & { description: string }): BankCandidate {
  return {
    locationId: "loc-1",
    customerId: "cus-1",
    vehicleId: "veh-1",
    jobId: "job-1",
    source: "quote_item",
    quoteItemId: "qi-1",
    inspectionItemId: null,
    price: 100,
    rag: null,
    ...overrides,
  };
}

describe("planBankUpserts", () => {
  it("inserts when no open row matches", () => {
    const { updates, inserts } = planBankUpserts([], [candidate({ description: "Replace front pads" })]);
    expect(updates).toHaveLength(0);
    expect(inserts).toHaveLength(1);
  });

  it("updates the existing open row on a (vehicle, description) match — case-insensitive", () => {
    const { updates, inserts } = planBankUpserts(
      [{ id: "dw-1", vehicle_id: "veh-1", description: "replace FRONT pads" }],
      [candidate({ description: "Replace front pads", price: 120 })],
    );
    expect(inserts).toHaveLength(0);
    expect(updates).toEqual([{ id: "dw-1", candidate: expect.objectContaining({ price: 120 }) }]);
  });

  it("same description on a different vehicle inserts", () => {
    const { updates, inserts } = planBankUpserts(
      [{ id: "dw-1", vehicle_id: "veh-OTHER", description: "Replace front pads" }],
      [candidate({ description: "Replace front pads" })],
    );
    expect(updates).toHaveLength(0);
    expect(inserts).toHaveLength(1);
  });

  it("null vehicle matches only null-vehicle rows", () => {
    const { updates, inserts } = planBankUpserts(
      [
        { id: "dw-veh", vehicle_id: "veh-1", description: "Air-con regas" },
        { id: "dw-null", vehicle_id: null, description: "Air-con regas" },
      ],
      [candidate({ description: "Air-con regas", vehicleId: null })],
    );
    expect(updates).toEqual([{ id: "dw-null", candidate: expect.anything() }]);
    expect(inserts).toHaveLength(0);
  });

  it("collapses duplicate candidates, first wins", () => {
    const { updates, inserts } = planBankUpserts(
      [],
      [
        candidate({ description: "Replace front pads", price: 100 }),
        candidate({ description: "replace front pads ", price: 999 }),
      ],
    );
    expect(updates).toHaveLength(0);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].price).toBe(100);
  });

  it("skips empty descriptions", () => {
    const { updates, inserts } = planBankUpserts([], [candidate({ description: "   " })]);
    expect(updates).toHaveLength(0);
    expect(inserts).toHaveLength(0);
  });
});
