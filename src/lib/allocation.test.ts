import { describe, expect, it } from "vitest";
import { allocatePayment } from "./allocation";

describe("allocatePayment", () => {
  const open = [
    { id: "a", outstanding: 100 },
    { id: "b", outstanding: 250 },
    { id: "c", outstanding: 40 },
  ];

  it("fills oldest first, splits across invoices", () => {
    const { allocations, unallocated } = allocatePayment(300, open);
    expect(allocations).toEqual([
      { invoiceId: "a", amount: 100 },
      { invoiceId: "b", amount: 200 },
    ]);
    expect(unallocated).toBe(0);
  });

  it("part-pays a single invoice", () => {
    const { allocations, unallocated } = allocatePayment(60, open);
    expect(allocations).toEqual([{ invoiceId: "a", amount: 60 }]);
    expect(unallocated).toBe(0);
  });

  it("overpayment stays unallocated as credit", () => {
    const { allocations, unallocated } = allocatePayment(500, open);
    expect(allocations).toEqual([
      { invoiceId: "a", amount: 100 },
      { invoiceId: "b", amount: 250 },
      { invoiceId: "c", amount: 40 },
    ]);
    expect(unallocated).toBe(110);
  });

  it("skips zero/negative outstanding, handles empties, and pennies", () => {
    expect(allocatePayment(50, [])).toEqual({ allocations: [], unallocated: 50 });
    expect(allocatePayment(0.03, [{ id: "x", outstanding: 0.01 }, { id: "y", outstanding: 0 }, { id: "z", outstanding: 5 }])).toEqual({
      allocations: [
        { invoiceId: "x", amount: 0.01 },
        { invoiceId: "z", amount: 0.02 },
      ],
      unallocated: 0,
    });
  });
});
