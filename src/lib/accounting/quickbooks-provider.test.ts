import { describe, expect, it } from "vitest";
import { creditNoteDocNumber, docNumber, qboQuoteValue } from "./quickbooks-provider";
import type { CreditNotePayload } from "./types";

describe("qboQuoteValue", () => {
  it("wraps in single quotes and escapes internal quotes", () => {
    expect(qboQuoteValue("O'Brien Motors")).toBe("'O\\'Brien Motors'");
    expect(qboQuoteValue("plain")).toBe("'plain'");
    expect(qboQuoteValue("back\\slash")).toBe("'back\\\\slash'");
  });
});

describe("docNumber", () => {
  it("caps at QBO's 21-character limit", () => {
    expect(docNumber("AIG-INV-0012")).toBe("AIG-INV-0012");
    expect(docNumber("AIG-BRANCH-LONG-INV-000123")).toHaveLength(21);
  });
});

describe("creditNoteDocNumber", () => {
  const base: CreditNotePayload = {
    ourCreditNoteId: "6a7b8c9d-1111-2222-3333-abcdefabcdef",
    referenceTag: "AIG-CN-6a7b8c9d-1111-2222-3333-abcdefabcdef",
    creditNumber: null,
    contactExternalId: "42",
    description: "Refund",
    amount: 10,
  };

  it("uses the credit number when present", () => {
    expect(creditNoteDocNumber({ ...base, creditNumber: "CN-0007" })).toBe("AIG-CN-0007");
  });

  it("derives a deterministic 21-char-safe number from the uuid otherwise", () => {
    const a = creditNoteDocNumber(base);
    const b = creditNoteDocNumber(base);
    expect(a).toBe(b);
    expect(a.length).toBeLessThanOrEqual(21);
    expect(a.startsWith("AIG-CN-")).toBe(true);
  });
});
