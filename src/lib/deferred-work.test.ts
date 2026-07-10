import { describe, expect, it } from "vitest";
import { groupDeferredRows, type RawDeferredRow } from "./deferred-work";

function row(overrides: Partial<RawDeferredRow> & { id: string }): RawDeferredRow {
  return {
    section: "Brakes",
    label: "Front pads & discs",
    rag: "amber",
    note: null,
    customer_summary: null,
    suggested_repair: null,
    suggested_price: null,
    outcome: "none",
    created_at: "2026-07-01T00:00:00Z",
    inspection: { id: "insp-1", vehicle_id: "veh-1", job_id: "job-1", status: "sent" },
    ...overrides,
  };
}

describe("groupDeferredRows", () => {
  it("groups findings by vehicle", () => {
    const out = groupDeferredRows([
      row({ id: "a" }),
      row({ id: "b", label: "NSF tyre", inspection: { id: "insp-2", vehicle_id: "veh-2", job_id: "job-2", status: "sent" } }),
    ]);
    expect(out.get("veh-1")).toHaveLength(1);
    expect(out.get("veh-2")).toHaveLength(1);
  });

  it("dedupes on (vehicle, label) keeping the newest-first row", () => {
    const out = groupDeferredRows([
      row({ id: "newer", created_at: "2026-07-09T00:00:00Z" }),
      row({ id: "older", created_at: "2026-06-01T00:00:00Z", inspection: { id: "insp-0", vehicle_id: "veh-1", job_id: "job-0", status: "sent" } }),
    ]);
    expect(out.get("veh-1")).toHaveLength(1);
    expect(out.get("veh-1")![0].id).toBe("newer");
  });

  it("same label on a different vehicle is kept", () => {
    const out = groupDeferredRows([
      row({ id: "a" }),
      row({ id: "b", inspection: { id: "insp-2", vehicle_id: "veh-2", job_id: "job-2", status: "sent" } }),
    ]);
    expect(out.get("veh-1")).toHaveLength(1);
    expect(out.get("veh-2")).toHaveLength(1);
  });

  it("excludes the current job's own check", () => {
    const out = groupDeferredRows(
      [row({ id: "a" }), row({ id: "b", label: "Battery", inspection: { id: "insp-2", vehicle_id: "veh-1", job_id: "job-2", status: "sent" } })],
      { excludeJobId: "job-1" },
    );
    expect(out.get("veh-1")).toHaveLength(1);
    expect(out.get("veh-1")![0].id).toBe("b");
  });

  it("caps per vehicle", () => {
    const rows = Array.from({ length: 5 }, (_, i) => row({ id: `r${i}`, label: `Item ${i}` }));
    const out = groupDeferredRows(rows, { limitPerVehicle: 3 });
    expect(out.get("veh-1")).toHaveLength(3);
  });

  it("maps fields through", () => {
    const out = groupDeferredRows([
      row({ id: "a", outcome: "declined", suggested_repair: "Replace pads", suggested_price: 48 }),
    ]);
    const f = out.get("veh-1")![0];
    expect(f).toMatchObject({
      outcome: "declined",
      suggestedRepair: "Replace pads",
      suggestedPrice: 48,
      jobId: "job-1",
      inspectionId: "insp-1",
      foundAt: "2026-07-01T00:00:00Z",
    });
  });
});
