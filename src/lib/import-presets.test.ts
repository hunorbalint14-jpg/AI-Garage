import { describe, expect, it } from "vitest";
import { detectPreset, presetMapping, IMPORT_PRESETS } from "./import-presets";
import { parseCsvText, validateInvoiceRows, missingRequired, TARGET_FIELDS } from "./import-engine";

describe("detectPreset", () => {
  it("fingerprints a TechMan history export", () => {
    const { headers } = parseCsvText("Registration,Invoice Date,Work Description,Mileage,Invoice Total\nAB12CDE,01/02/2024,Service,40000,150\n");
    expect(detectPreset(headers)?.key).toBe("techman");
  });

  it("fingerprints Garage Hive and Autowork Online", () => {
    expect(detectPreset(["document_no", "posting_date", "amount_including_vat"])?.key).toBe("garage-hive");
    expect(detectPreset(["inv_number", "inv_date", "inv_total"])?.key).toBe("autowork-online");
  });

  it("random headers match nothing", () => {
    expect(detectPreset(["foo", "bar"])).toBeNull();
  });
});

describe("presetMapping", () => {
  it("covers every required field for every kind it claims", () => {
    for (const preset of IMPORT_PRESETS) {
      for (const [kind, dict] of Object.entries(preset.mappings)) {
        const headers = Object.values(dict);
        const mapping = presetMapping(preset, kind as keyof typeof preset.mappings, headers)!;
        expect(missingRequired(kind as keyof typeof TARGET_FIELDS, mapping)).toEqual([]);
      }
    }
  });

  it("drops mapped headers that are not in the file", () => {
    const techman = IMPORT_PRESETS[0];
    const m = presetMapping(techman, "history", ["registration", "invoice_date", "work_description"])!;
    expect(m.registration).toBe("registration");
    expect(m.mileage).toBeNull();
  });
});

describe("validateInvoiceRows", () => {
  const MAP = {
    invoice_number: "no",
    issued_on: "date",
    total: "total",
    customer_email: "email",
    registration: "reg",
    status: "status",
    description: null,
  };

  it("needs a number, a date, an amount and someone to hang it on", () => {
    const rows = [
      { no: "INV-901", date: "14/05/2023", total: "£312.40", email: "a@b.co", reg: "", status: "Paid" },
      { no: "", date: "14/05/2023", total: "10", email: "a@b.co", reg: "", status: "" },
      { no: "INV-902", date: "14/05/2023", total: "ten", email: "a@b.co", reg: "", status: "" },
      { no: "INV-903", date: "14/05/2023", total: "10", email: "", reg: "", status: "" },
    ];
    const { valid, rejects } = validateInvoiceRows(rows, MAP);
    expect(valid).toHaveLength(1);
    expect(valid[0]).toMatchObject({ invoice_number: "INV-901", issued_on: "2023-05-14", total: 312.4, status: "Paid" });
    expect(rejects.map((r) => r.row)).toEqual([3, 4, 5]);
    expect(rejects[2].reason).toMatch(/no customer email or registration/);
  });
});
