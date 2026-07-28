import { describe, expect, it } from "vitest";
import { buildCreditNoteLines, buildSalesLines } from "./sync";

const NO_DEDUCTIONS = {
  membershipCredit: { amount: 0, description: null },
  discount: { amount: 0, description: null },
};

const NO_ALTERNATES = { consolidated: null, booking: null };

describe("buildSalesLines", () => {
  it("maps job items with per-line treatment snapshots", () => {
    const lines = buildSalesLines({
      orgVatRegistered: true,
      jobItems: [
        { description: "Labour", quantity: 2, unit_price: 65, vat_rate: 20, vat_treatment: "standard" },
        { description: "MOT fee", quantity: 1, unit_price: 54.85, vat_rate: 0, vat_treatment: "outside_scope" },
        { description: "Zero-rated part", quantity: 1, unit_price: 20, vat_rate: 0, vat_treatment: "zero" },
        { description: "Brake pads", quantity: 1, unit_price: 42.5, vat_rate: null, vat_treatment: null }, // legacy null → 20 → standard
      ],
      ...NO_ALTERNATES,
      fallback: { invoiceNumber: "INV-0001", subtotal: 0 },
      ...NO_DEDUCTIONS,
    });
    expect(lines).toEqual([
      { description: "Labour", quantity: 2, unitAmount: 65, taxTreatment: "standard" },
      { description: "MOT fee", quantity: 1, unitAmount: 54.85, taxTreatment: "outside_scope" },
      { description: "Zero-rated part", quantity: 1, unitAmount: 20, taxTreatment: "zero" },
      { description: "Brake pads", quantity: 1, unitAmount: 42.5, taxTreatment: "standard" },
    ]);
  });

  it("legacy 0% line without treatment falls back to outside_scope (historic no-VAT push)", () => {
    const lines = buildSalesLines({
      orgVatRegistered: true,
      jobItems: [{ description: "Old MOT", quantity: 1, unit_price: 54.85, vat_rate: 0 }],
      ...NO_ALTERNATES,
      fallback: { invoiceNumber: "INV-0001", subtotal: 0 },
      ...NO_DEDUCTIONS,
    });
    expect(lines[0].taxTreatment).toBe("outside_scope");
  });

  it("unregistered org forces every line to no_vat", () => {
    const lines = buildSalesLines({
      orgVatRegistered: false,
      jobItems: [
        { description: "Labour", quantity: 1, unit_price: 100, vat_rate: 20, vat_treatment: "standard" },
        { description: "MOT fee", quantity: 1, unit_price: 54.85, vat_rate: 0, vat_treatment: "outside_scope" },
      ],
      ...NO_ALTERNATES,
      fallback: { invoiceNumber: "INV-0001", subtotal: 0 },
      ...NO_DEDUCTIONS,
    });
    expect(lines.map((l) => l.taxTreatment)).toEqual(["no_vat", "no_vat"]);
  });

  it("booking invoice becomes a single service line with its treatment", () => {
    const lines = buildSalesLines({
      orgVatRegistered: true,
      jobItems: null,
      consolidated: null,
      booking: { serviceName: "Full service", when: "3 July, 09:30", subtotal: 120, taxTreatment: "standard" },
      fallback: { invoiceNumber: "INV-0002", subtotal: 120 },
      ...NO_DEDUCTIONS,
    });
    expect(lines).toEqual([
      { description: "Full service — 3 July, 09:30", quantity: 1, unitAmount: 120, taxTreatment: "standard" },
    ]);
  });

  it("MOT booking invoice carries outside_scope", () => {
    const lines = buildSalesLines({
      orgVatRegistered: true,
      jobItems: null,
      consolidated: null,
      booking: { serviceName: "MOT", when: null, subtotal: 54.85, taxTreatment: "outside_scope" },
      fallback: { invoiceNumber: "INV-0002", subtotal: 54.85 },
      ...NO_DEDUCTIONS,
    });
    expect(lines[0].taxTreatment).toBe("outside_scope");
  });

  it("consolidated invoice maps per-job treatment-split lines", () => {
    const lines = buildSalesLines({
      orgVatRegistered: true,
      jobItems: null,
      consolidated: [
        { description: "3 Jul · AB12 CDE · Brakes — standard-rated", net: 150, taxTreatment: "standard" },
        { description: "3 Jul · AB12 CDE · Brakes — outside scope", net: 54.85, taxTreatment: "outside_scope" },
        { description: "12 Jul · XY34 ZZZ · Service", net: 80, taxTreatment: "standard" },
      ],
      booking: null,
      fallback: { invoiceNumber: "INV-0009", subtotal: 284.85 },
      ...NO_DEDUCTIONS,
    });
    expect(lines).toHaveLength(3);
    expect(lines.map((l) => l.taxTreatment)).toEqual(["standard", "outside_scope", "standard"]);
  });

  it("falls back to a single standard invoice line when there is no job, consolidation, or booking", () => {
    const lines = buildSalesLines({
      orgVatRegistered: true,
      jobItems: null,
      ...NO_ALTERNATES,
      fallback: { invoiceNumber: "INV-0003", subtotal: 80 },
      ...NO_DEDUCTIONS,
    });
    expect(lines).toEqual([
      { description: "Invoice INV-0003", quantity: 1, unitAmount: 80, taxTreatment: "standard" },
    ]);
  });

  it("membership credit and discount append as negative standard-rated lines when any line is standard", () => {
    const lines = buildSalesLines({
      orgVatRegistered: true,
      jobItems: [
        { description: "Labour", quantity: 1, unit_price: 100, vat_rate: 20, vat_treatment: "standard" },
        { description: "MOT fee", quantity: 1, unit_price: 54.85, vat_rate: 0, vat_treatment: "outside_scope" },
      ],
      ...NO_ALTERNATES,
      fallback: { invoiceNumber: "INV-0004", subtotal: 154.85 },
      membershipCredit: { amount: 30, description: "Interim service included" },
      discount: { amount: 10, description: null },
    });
    expect(lines.slice(2)).toEqual([
      { description: "Interim service included", quantity: 1, unitAmount: -30, taxTreatment: "standard" },
      { description: "Member discount", quantity: 1, unitAmount: -10, taxTreatment: "standard" },
    ]);
  });

  it("deductions on an all-0% invoice keep the first line's treatment (no phantom VAT subtraction)", () => {
    const lines = buildSalesLines({
      orgVatRegistered: true,
      jobItems: [{ description: "MOT fee", quantity: 1, unit_price: 54.85, vat_rate: 0, vat_treatment: "outside_scope" }],
      ...NO_ALTERNATES,
      fallback: { invoiceNumber: "INV-0006", subtotal: 54.85 },
      membershipCredit: { amount: 10, description: null },
      discount: { amount: 0, description: null },
    });
    expect(lines[1].taxTreatment).toBe("outside_scope");
  });

  it("empty job_items falls through to the fallback line, not zero lines", () => {
    const lines = buildSalesLines({
      orgVatRegistered: true,
      jobItems: [],
      ...NO_ALTERNATES,
      fallback: { invoiceNumber: "INV-0005", subtotal: 55 },
      ...NO_DEDUCTIONS,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0].description).toBe("Invoice INV-0005");
  });
});

describe("buildCreditNoteLines", () => {
  it("all-standard refund is a single standard line", () => {
    const lines = buildCreditNoteLines({
      description: "Refund — faulty part",
      subtotal: 100,
      vatAmount: 20,
      orgVatRegistered: true,
    });
    expect(lines).toEqual([
      { description: "Refund — faulty part", quantity: 1, unitAmount: 100, taxTreatment: "standard" },
    ]);
  });

  it("0%-VAT refund (MOT fee) never gains VAT provider-side", () => {
    const lines = buildCreditNoteLines({
      description: "Refund — MOT",
      subtotal: 54.85,
      vatAmount: 0,
      orgVatRegistered: true,
    });
    expect(lines).toEqual([
      { description: "Refund — MOT", quantity: 1, unitAmount: 54.85, taxTreatment: "outside_scope" },
    ]);
  });

  it("unregistered org refund is a single no_vat line", () => {
    const lines = buildCreditNoteLines({
      description: "Refund",
      subtotal: 80,
      vatAmount: 0,
      orgVatRegistered: false,
    });
    expect(lines[0].taxTreatment).toBe("no_vat");
  });

  it("blended-rate refund splits into standard + no-VAT portions that add to the stored totals", () => {
    // Mixed invoice: £100 standard + £54.85 outside scope → blended rate ≈ 12.92%.
    // Full refund gross = £174.85, stored as net 154.85 / VAT 20.00.
    const lines = buildCreditNoteLines({
      description: "Refund — full",
      subtotal: 154.85,
      vatAmount: 20,
      orgVatRegistered: true,
    });
    expect(lines).toEqual([
      { description: "Refund — full", quantity: 1, unitAmount: 100, taxTreatment: "standard" },
      { description: "Refund — full — no-VAT portion", quantity: 1, unitAmount: 54.85, taxTreatment: "outside_scope" },
    ]);
    // Provider-side gross: 100 * 1.2 + 54.85 = 174.85 — matches ours exactly.
    const gross = lines.reduce((s, l) => s + l.unitAmount * (l.taxTreatment === "standard" ? 1.2 : 1), 0);
    expect(gross).toBeCloseTo(174.85, 2);
  });

  it("rounding never produces a negative no-VAT remainder", () => {
    const lines = buildCreditNoteLines({
      description: "Refund",
      subtotal: 99.99,
      vatAmount: 20,
      orgVatRegistered: true,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual({ description: "Refund", quantity: 1, unitAmount: 99.99, taxTreatment: "standard" });
  });
});
