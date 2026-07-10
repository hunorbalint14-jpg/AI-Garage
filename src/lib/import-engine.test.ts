import { describe, expect, it } from "vitest";
import {
  parseCsvText,
  autoMap,
  parseDateFlexible,
  parseMoney,
  missingRequired,
  validateHistoryRows,
  validateReminderRows,
} from "./import-engine";

describe("parseCsvText", () => {
  it("handles quotes, embedded commas and CRLF", () => {
    const { headers, rows } = parseCsvText('Reg No,Description\r\nAB12 CDE,"Brakes, front"\r\n');
    expect(headers).toEqual(["reg_no", "description"]);
    expect(rows[0].description).toBe("Brakes, front");
  });

  it("sniffs semicolon delimiters (TechMan locales) and strips BOM", () => {
    const { headers, rows } = parseCsvText("﻿Reg;MOT Due\nAB12CDE;01/03/2027\n");
    expect(headers).toEqual(["reg", "mot_due"]);
    expect(rows[0].mot_due).toBe("01/03/2027");
  });

  it("doubled quotes decode to a literal quote", () => {
    const { rows } = parseCsvText('a,b\n"say ""hi""",2\n');
    expect(rows[0].a).toBe('say "hi"');
  });
});

describe("autoMap", () => {
  it("matches aliases and leaves the rest null", () => {
    const m = autoMap(["vrm", "work_done", "invoice_date", "gross", "unrelated"], "history");
    expect(m.registration).toBe("vrm");
    expect(m.description).toBe("work_done");
    expect(m.happened_on).toBe("invoice_date");
    expect(m.total).toBe("gross");
    expect(m.mileage).toBeNull();
  });

  it("missingRequired names unmapped required fields", () => {
    const m = autoMap(["unrelated"], "history");
    expect(missingRequired("history", m)).toEqual(["Vehicle registration", "Date", "Work description"]);
  });
});

describe("parseDateFlexible", () => {
  it("UK, ISO and two-digit years", () => {
    expect(parseDateFlexible("03/02/2026")).toBe("2026-02-03"); // dd/mm
    expect(parseDateFlexible("2026-02-03")).toBe("2026-02-03");
    expect(parseDateFlexible("3-2-99")).toBe("1999-02-03");
    expect(parseDateFlexible("31/02/2026")).toBeNull(); // impossible
    expect(parseDateFlexible("soon")).toBeNull();
  });
});

describe("parseMoney", () => {
  it("strips currency + thousands", () => {
    expect(parseMoney("£1,234.50")).toBe(1234.5);
    expect(parseMoney("89")).toBe(89);
    expect(parseMoney("n/a")).toBeNull();
  });
});

const HMAP = { registration: "reg", happened_on: "date", description: "work", mileage: "miles", total: "total" };

describe("validateHistoryRows", () => {
  it("valid rows normalise; rejects carry row number + reason", () => {
    const rows = [
      { reg: "ab12 cde", date: "05/06/2024", work: "Full service", miles: "42,000", total: "£189.99" },
      { reg: "", date: "05/06/2024", work: "x", miles: "", total: "" },
      { reg: "CD34 EFG", date: "yesterday", work: "x", miles: "", total: "" },
    ];
    const { valid, rejects } = validateHistoryRows(rows, HMAP);
    expect(valid).toHaveLength(1);
    expect(valid[0]).toMatchObject({ registration: "AB12CDE", happened_on: "2024-06-05", mileage: 42000, total: 189.99 });
    expect(rejects).toEqual([
      { row: 3, reason: "registration is empty" },
      { row: 4, reason: 'date "yesterday" not recognised (use dd/mm/yyyy)' },
    ]);
  });
});

describe("validateReminderRows", () => {
  const RMAP = { registration: "reg", mot_expiry: "mot", service_due: "svc", tax_due_date: null };

  it("needs at least one date; bad dates reject the row", () => {
    const rows = [
      { reg: "AB12CDE", mot: "01/03/2027", svc: "" },
      { reg: "CD34EFG", mot: "", svc: "" },
      { reg: "EF56GHI", mot: "not a date", svc: "01/01/2027" },
    ];
    const { valid, rejects } = validateReminderRows(rows, RMAP);
    expect(valid).toHaveLength(1);
    expect(valid[0]).toMatchObject({ registration: "AB12CDE", mot_expiry: "2027-03-01", service_due: null });
    expect(rejects.map((r) => r.row)).toEqual([3, 4]);
  });
});
