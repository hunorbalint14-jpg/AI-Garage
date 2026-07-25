import { describe, it, expect } from "vitest";
import { renderSupplierOrderEmail } from "./order-email";
import type { OrderRequest } from "./types";

const req: OrderRequest = {
  reference: "PO-0042",
  lines: [
    { sku: "BD-9921", description: "Brake Disc Pair Front", quantity: 2, unitCost: 42.5 },
    { sku: null, description: "Brake Pad Set Front", quantity: 1, unitCost: 24 },
  ],
  notes: "Collection before 4pm please.",
  orgName: "Smith Motors",
  locationName: "Camden",
  locationAddress: "12 High St\nLondon\nNW1 0AB",
  replyTo: "parts@smithmotors.example",
};

describe("renderSupplierOrderEmail", () => {
  const email = renderSupplierOrderEmail(req, { accountNumber: "SM-4471", supplierName: "GSF Camden" });

  it("puts our reference in the subject so the supplier quotes it back", () => {
    expect(email.subject).toBe("Parts order PO-0042 — Smith Motors");
  });

  it("identifies the ordering BRANCH, not just the org", () => {
    expect(email.text).toContain("Smith Motors — Camden");
    expect(email.text).toContain("12 High St");
    expect(email.html).toContain("Camden");
  });

  it("prints the trade account when set, and omits it when not", () => {
    expect(email.text).toContain("Trade account: SM-4471");
    const noAccount = renderSupplierOrderEmail(req, { accountNumber: null, supplierName: "GSF Camden" });
    expect(noAccount.text).not.toContain("Trade account");
  });

  it("lists every line with quantity, unit cost and line total", () => {
    expect(email.text).toContain("2 x Brake Disc Pair Front (BD-9921) @ £42.50 = £85.00");
    expect(email.text).toContain("1 x Brake Pad Set Front @ £24.00 = £24.00");
  });

  it("totals the order ex VAT and flags the prices as ours to confirm", () => {
    expect(email.text).toContain("£109.00");
    expect(email.text).toMatch(/please confirm/i);
  });

  it("carries the notes through", () => {
    expect(email.text).toContain("Collection before 4pm please.");
  });
});
