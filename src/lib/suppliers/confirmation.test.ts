import { describe, it, expect } from "vitest";
import { parseConfirmation } from "./confirmation";

describe("parseConfirmation", () => {
  it("reads an emailed confirmation with quantity-prefixed lines", () => {
    const result = parseConfirmation(`
Order confirmation
Our order reference: GSF-889321
Your ref: PO-0042

2 x Brake Disc Pair Front (BD-9921) £42.50 each  £85.00
1 x Brake Pad Set Front  £24.00

Subtotal £109.00
VAT £21.80
Total £130.80
`);

    expect(result.supplierOrderRef).toBe("GSF-889321");
    expect(result.lines).toEqual([
      { sku: "BD-9921", description: "Brake Disc Pair Front", quantity: 2, unitCost: 42.5 },
      { sku: null, description: "Brake Pad Set Front", quantity: 1, unitCost: 24 },
    ]);
  });

  it("reads a CSV export", () => {
    const result = parseConfirmation(`
SKU,Description,Qty,Unit price,Line total
BD-9921,Brake Disc Pair Front,2,42.50,85.00
BP-1188,Brake Pad Set Front,1,24.00,24.00
`);

    expect(result.lines).toEqual([
      { sku: "BD-9921", description: "Brake Disc Pair Front", quantity: 2, unitCost: 42.5 },
      { sku: "BP-1188", description: "Brake Pad Set Front", quantity: 1, unitCost: 24 },
    ]);
  });

  it("reads column-aligned text", () => {
    const result = parseConfirmation(
      "OIL-5W30-5L    Fully synthetic 5W30 5L    3    £18.99    £56.97",
    );
    expect(result.lines).toEqual([
      { sku: "OIL-5W30-5L", description: "Fully synthetic 5W30 5L", quantity: 3, unitCost: 18.99 },
    ]);
  });

  it("picks the unit price, not the line total, when both are present", () => {
    // qty x 12.00 = 36.00 proves which column is the unit price regardless of
    // the order the two money values appear in.
    const flipped = parseConfirmation("WIPER-22,Wiper blade 22in,3,36.00,12.00");
    expect(flipped.lines[0].unitCost).toBe(12);
  });

  it("ignores totals, headers and our own reference", () => {
    const result = parseConfirmation(`
Your order ref: PO-0042
Qty,Description,Price
Delivery,,1,7.50
Total,,,130.80
`);
    expect(result.supplierOrderRef).toBeNull();
    expect(result.lines).toEqual([]);
  });

  it("returns no lines rather than guessing when the text is unreadable", () => {
    const result = parseConfirmation("Thanks for your order — it will ship tomorrow.");
    expect(result.lines).toEqual([]);
    expect(result.supplierOrderRef).toBeNull();
  });

  it("handles comma decimal separators and thousands separators", () => {
    const result = parseConfirmation("1 x Turbocharger assembly £1,249.99");
    expect(result.lines[0].unitCost).toBe(1249.99);
  });

  it("does not mistake our reference for the supplier's", () => {
    const result = parseConfirmation("Your reference: PO-0042\nOrder no: A-778812");
    expect(result.supplierOrderRef).toBe("A-778812");
  });
});
