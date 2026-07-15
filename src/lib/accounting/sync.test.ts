import { describe, expect, it } from "vitest";
import { buildSalesLines } from "./sync";

const NO_DEDUCTIONS = {
  membershipCredit: { amount: 0, description: null },
  discount: { amount: 0, description: null },
};

describe("buildSalesLines", () => {
  it("maps job items with per-line VAT snapshots", () => {
    const lines = buildSalesLines({
      invoiceHasVat: true,
      jobItems: [
        { description: "Labour", quantity: 2, unit_price: 65, vat_rate: 20 },
        { description: "MOT fee", quantity: 1, unit_price: 54.85, vat_rate: 0 },
        { description: "Brake pads", quantity: 1, unit_price: 42.5, vat_rate: null }, // legacy null → 20
      ],
      booking: null,
      fallback: { invoiceNumber: "INV-0001", subtotal: 0 },
      ...NO_DEDUCTIONS,
    });
    expect(lines).toEqual([
      { description: "Labour", quantity: 2, unitAmount: 65, standardRated: true },
      { description: "MOT fee", quantity: 1, unitAmount: 54.85, standardRated: false },
      { description: "Brake pads", quantity: 1, unitAmount: 42.5, standardRated: true },
    ]);
  });

  it("unregistered org (no VAT on invoice) forces every line non-standard", () => {
    const lines = buildSalesLines({
      invoiceHasVat: false,
      jobItems: [{ description: "Labour", quantity: 1, unit_price: 100, vat_rate: 20 }],
      booking: null,
      fallback: { invoiceNumber: "INV-0001", subtotal: 0 },
      ...NO_DEDUCTIONS,
    });
    expect(lines[0].standardRated).toBe(false);
  });

  it("booking invoice becomes a single service line with the slot label", () => {
    const lines = buildSalesLines({
      invoiceHasVat: true,
      jobItems: null,
      booking: { serviceName: "Full service", when: "3 July, 09:30", subtotal: 120 },
      fallback: { invoiceNumber: "INV-0002", subtotal: 120 },
      ...NO_DEDUCTIONS,
    });
    expect(lines).toEqual([
      { description: "Full service — 3 July, 09:30", quantity: 1, unitAmount: 120, standardRated: true },
    ]);
  });

  it("falls back to a single invoice line when there is no job or booking", () => {
    const lines = buildSalesLines({
      invoiceHasVat: true,
      jobItems: null,
      booking: null,
      fallback: { invoiceNumber: "INV-0003", subtotal: 80 },
      ...NO_DEDUCTIONS,
    });
    expect(lines).toEqual([
      { description: "Invoice INV-0003", quantity: 1, unitAmount: 80, standardRated: true },
    ]);
  });

  it("membership credit and discount append as negative standard-rated lines", () => {
    const lines = buildSalesLines({
      invoiceHasVat: true,
      jobItems: [{ description: "Labour", quantity: 1, unit_price: 100, vat_rate: 20 }],
      booking: null,
      fallback: { invoiceNumber: "INV-0004", subtotal: 100 },
      membershipCredit: { amount: 30, description: "Interim service included" },
      discount: { amount: 10, description: null },
    });
    expect(lines.slice(1)).toEqual([
      { description: "Interim service included", quantity: 1, unitAmount: -30, standardRated: true },
      { description: "Member discount", quantity: 1, unitAmount: -10, standardRated: true },
    ]);
  });

  it("empty job_items falls through to the fallback line, not zero lines", () => {
    const lines = buildSalesLines({
      invoiceHasVat: true,
      jobItems: [],
      booking: null,
      fallback: { invoiceNumber: "INV-0005", subtotal: 55 },
      ...NO_DEDUCTIONS,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0].description).toBe("Invoice INV-0005");
  });
});
