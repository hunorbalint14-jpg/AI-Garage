// Competitor export presets (#505 PR 3): header mappings for the three
// incumbents' CSV exports so a switcher's file loads without manual mapping.
// Best-effort from public export formats — refined the first time a real
// switcher's file lands (docs/migration-runbook.md tracks the known shapes).
// Header names here are NORMALISED (lowercase, non-alnum → _), matching
// parseCsvText's header treatment.

import type { ColumnMapping, ImportKind } from "@/lib/import-engine";

export type ImportPreset = {
  key: string;
  label: string;
  /** Normalised headers that identify this vendor's export (any kind). A file
   * matches when it contains every header of at least one kind's signature. */
  signatures: string[][];
  /** targetField → vendor header, per import kind. Missing kind = no preset. */
  mappings: Partial<Record<ImportKind, Record<string, string>>>;
};

export const IMPORT_PRESETS: ImportPreset[] = [
  {
    key: "techman",
    label: "TechMan",
    signatures: [
      ["customer_name", "registration", "mot_due"],
      ["registration", "invoice_date", "work_description"],
      ["invoice_no", "invoice_date", "gross_total"],
    ],
    mappings: {
      customers: {
        full_name: "customer_name",
        email: "email_address",
        phone: "mobile_number",
        registration: "registration",
        make: "make",
        model: "model",
        mot_expiry: "mot_due",
        service_due: "service_due",
      },
      history: {
        registration: "registration",
        happened_on: "invoice_date",
        description: "work_description",
        mileage: "mileage",
        total: "invoice_total",
      },
      reminders: {
        registration: "registration",
        mot_expiry: "mot_due",
        service_due: "service_due",
      },
      invoices: {
        invoice_number: "invoice_no",
        issued_on: "invoice_date",
        total: "gross_total",
        customer_email: "email_address",
        registration: "registration",
        status: "status",
        description: "description",
      },
    },
  },
  {
    key: "garage-hive",
    label: "Garage Hive",
    signatures: [
      ["name", "vehicle_registration_no", "mot_expiry_date"],
      ["vehicle_registration_no", "posting_date", "description"],
      ["document_no", "posting_date", "amount_including_vat"],
    ],
    mappings: {
      customers: {
        full_name: "name",
        email: "e_mail",
        phone: "phone_no",
        registration: "vehicle_registration_no",
        make: "make",
        model: "model",
        mot_expiry: "mot_expiry_date",
        service_due: "next_service_date",
      },
      history: {
        registration: "vehicle_registration_no",
        happened_on: "posting_date",
        description: "description",
        mileage: "mileage",
        total: "amount_including_vat",
      },
      reminders: {
        registration: "vehicle_registration_no",
        mot_expiry: "mot_expiry_date",
        service_due: "next_service_date",
      },
      invoices: {
        invoice_number: "document_no",
        issued_on: "posting_date",
        total: "amount_including_vat",
        customer_email: "e_mail",
        registration: "vehicle_registration_no",
        description: "description",
      },
    },
  },
  {
    key: "autowork-online",
    label: "Autowork Online",
    signatures: [
      ["cust_name", "reg_no", "mot_date"],
      ["reg_no", "job_date", "job_details"],
      ["inv_number", "inv_date", "inv_total"],
    ],
    mappings: {
      customers: {
        full_name: "cust_name",
        email: "email",
        phone: "tel_no",
        registration: "reg_no",
        make: "make",
        model: "model",
        mot_expiry: "mot_date",
        service_due: "service_date",
      },
      history: {
        registration: "reg_no",
        happened_on: "job_date",
        description: "job_details",
        mileage: "mileage",
        total: "job_total",
      },
      reminders: {
        registration: "reg_no",
        mot_expiry: "mot_date",
        service_due: "service_date",
      },
      invoices: {
        invoice_number: "inv_number",
        issued_on: "inv_date",
        total: "inv_total",
        customer_email: "email",
        registration: "reg_no",
      },
    },
  },
];

/** Detect which vendor a file came from: every header of at least one
 * signature must be present. */
export function detectPreset(headers: string[]): ImportPreset | null {
  const set = new Set(headers);
  for (const preset of IMPORT_PRESETS) {
    if (preset.signatures.some((sig) => sig.every((h) => set.has(h)))) return preset;
  }
  return null;
}

/** A preset's mapping restricted to headers actually in the file; null when
 * the preset has nothing for this kind. */
export function presetMapping(preset: ImportPreset, kind: ImportKind, headers: string[]): ColumnMapping | null {
  const dict = preset.mappings[kind];
  if (!dict) return null;
  const set = new Set(headers);
  const mapping: ColumnMapping = {};
  for (const [target, source] of Object.entries(dict)) {
    mapping[target] = set.has(source) ? source : null;
  }
  return mapping;
}
