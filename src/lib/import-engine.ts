// Migration-toolkit import engine (#505 PR 2). Pure: CSV parsing, column
// mapping, per-kind row validation, dry-run reporting. IO (vehicle lookups,
// inserts, batches) lives in the wizard's server actions.

export type ImportKind = "customers" | "history" | "reminders" | "invoices";

/** targetField → source header (null = unmapped). */
export type ColumnMapping = Record<string, string | null>;

export type TargetField = {
  key: string;
  label: string;
  required: boolean;
  /** Normalised header names that auto-match this field. */
  aliases: string[];
};

export const TARGET_FIELDS: Record<ImportKind, TargetField[]> = {
  customers: [
    { key: "full_name", label: "Full name", required: true, aliases: ["full_name", "name", "customer", "customer_name", "contact"] },
    { key: "email", label: "Email", required: true, aliases: ["email", "email_address", "e_mail"] },
    { key: "phone", label: "Phone", required: false, aliases: ["phone", "mobile", "telephone", "tel", "phone_number", "mobile_number"] },
    { key: "registration", label: "Vehicle registration", required: false, aliases: ["registration", "reg", "reg_no", "vrm", "number_plate", "plate"] },
    { key: "make", label: "Make", required: false, aliases: ["make", "manufacturer"] },
    { key: "model", label: "Model", required: false, aliases: ["model"] },
    { key: "year", label: "Year", required: false, aliases: ["year", "year_of_manufacture"] },
    { key: "mot_expiry", label: "MOT expiry", required: false, aliases: ["mot_expiry", "mot_due", "mot_due_date", "mot"] },
    { key: "service_due", label: "Service due", required: false, aliases: ["service_due", "next_service", "service_due_date"] },
  ],
  history: [
    { key: "registration", label: "Vehicle registration", required: true, aliases: ["registration", "reg", "reg_no", "vrm", "number_plate", "plate", "vehicle"] },
    { key: "happened_on", label: "Date", required: true, aliases: ["date", "happened_on", "invoice_date", "job_date", "completed", "work_date"] },
    { key: "description", label: "Work description", required: true, aliases: ["description", "work", "work_done", "details", "job_description", "narrative"] },
    { key: "mileage", label: "Mileage", required: false, aliases: ["mileage", "odometer", "miles", "odo"] },
    { key: "total", label: "Total (£)", required: false, aliases: ["total", "amount", "invoice_total", "gross", "price"] },
  ],
  reminders: [
    { key: "registration", label: "Vehicle registration", required: true, aliases: ["registration", "reg", "reg_no", "vrm", "number_plate", "plate", "vehicle"] },
    { key: "mot_expiry", label: "MOT expiry", required: false, aliases: ["mot_expiry", "mot_due", "mot_due_date", "mot"] },
    { key: "service_due", label: "Service due", required: false, aliases: ["service_due", "next_service", "service_due_date", "service"] },
    { key: "tax_due_date", label: "Tax due", required: false, aliases: ["tax_due_date", "tax_due", "ved_due", "tax"] },
  ],
  invoices: [
    { key: "invoice_number", label: "Invoice number", required: true, aliases: ["invoice_number", "invoice_no", "inv_no", "number", "doc_no", "document_no"] },
    { key: "issued_on", label: "Invoice date", required: true, aliases: ["issued_on", "invoice_date", "date", "doc_date"] },
    { key: "total", label: "Total (£)", required: true, aliases: ["total", "gross", "invoice_total", "amount", "gross_total"] },
    { key: "customer_email", label: "Customer email", required: false, aliases: ["customer_email", "email", "email_address", "e_mail"] },
    { key: "registration", label: "Vehicle registration", required: false, aliases: ["registration", "reg", "reg_no", "vrm", "number_plate", "plate", "vehicle"] },
    { key: "status", label: "Status", required: false, aliases: ["status", "state", "paid"] },
    { key: "description", label: "Description", required: false, aliases: ["description", "details", "work_done", "narrative"] },
  ],
};

// ── CSV ──────────────────────────────────────────────────────────────────────

function parseLine(line: string, delim: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      // Doubled quote inside a quoted field = literal quote.
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delim && !inQuotes) {
      values.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  values.push(current);
  return values;
}

/** Sniff the delimiter from the header line: comma vs semicolon (TechMan
 * exports semicolons in some locales). */
function sniffDelimiter(headerLine: string): string {
  const commas = (headerLine.match(/,/g) ?? []).length;
  const semis = (headerLine.match(/;/g) ?? []).length;
  return semis > commas ? ";" : ",";
}

const normalizeHeader = (h: string) => h.trim().toLowerCase().replace(/^﻿/, "").replace(/[\s/-]+/g, "_");

export type ParsedCsv = {
  /** Normalised header names, in file order. */
  headers: string[];
  /** Rows keyed by normalised header. */
  rows: Record<string, string>[];
};

export function parseCsvText(text: string): ParsedCsv {
  const clean = text.replace(/^﻿/, "");
  const lines = clean.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.length < 2) return { headers: [], rows: [] };
  const delim = sniffDelimiter(lines[0]);
  const headers = parseLine(lines[0], delim).map(normalizeHeader);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = parseLine(lines[i], delim);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = (values[idx] ?? "").trim();
    });
    rows.push(row);
  }
  return { headers, rows };
}

// ── Mapping ──────────────────────────────────────────────────────────────────

/** Auto-match file headers to target fields by alias. */
export function autoMap(headers: string[], kind: ImportKind): ColumnMapping {
  const mapping: ColumnMapping = {};
  const taken = new Set<string>();
  for (const field of TARGET_FIELDS[kind]) {
    const hit = headers.find((h) => !taken.has(h) && field.aliases.includes(h));
    mapping[field.key] = hit ?? null;
    if (hit) taken.add(hit);
  }
  return mapping;
}

// ── Values ───────────────────────────────────────────────────────────────────

/** dd/mm/yyyy · dd-mm-yyyy · yyyy-mm-dd · dd/mm/yy → ISO date, else null. */
export function parseDateFlexible(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
  let day: number, month: number, year: number;
  if (m) {
    [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else {
    m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(v);
    if (!m) return null;
    [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (year < 100) year += year >= 70 ? 1900 : 2000;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1950 || year > 2100) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  // Reject impossible dates (31 Feb rolls over in Date — catch it).
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d.toISOString().slice(0, 10);
}

/** "£1,234.50" / "1234.5" → 1234.5, else null. */
export function parseMoney(raw: string): number | null {
  const v = raw.trim().replace(/[£$€,\s]/g, "");
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

// ── Validation ───────────────────────────────────────────────────────────────

export type RowReject = { row: number; reason: string };

export type HistoryRow = {
  row: number;
  registration: string; // normalised
  happened_on: string; // ISO date
  description: string;
  mileage: number | null;
  total: number | null;
};

export type ReminderRow = {
  row: number;
  registration: string; // normalised
  mot_expiry: string | null;
  service_due: string | null;
  tax_due_date: string | null;
};

const normalizeReg = (reg: string) => reg.toUpperCase().replace(/\s+/g, "");

function mapped(row: Record<string, string>, mapping: ColumnMapping, key: string): string {
  const src = mapping[key];
  return src ? (row[src] ?? "") : "";
}

export function missingRequired(kind: ImportKind, mapping: ColumnMapping): string[] {
  return TARGET_FIELDS[kind].filter((f) => f.required && !mapping[f.key]).map((f) => f.label);
}

export function validateHistoryRows(
  rows: Record<string, string>[],
  mapping: ColumnMapping,
): { valid: HistoryRow[]; rejects: RowReject[] } {
  const valid: HistoryRow[] = [];
  const rejects: RowReject[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2; // 1-based + header
    const reg = mapped(row, mapping, "registration").trim();
    if (!reg) {
      rejects.push({ row: rowNum, reason: "registration is empty" });
      continue;
    }
    const dateRaw = mapped(row, mapping, "happened_on");
    const happened = parseDateFlexible(dateRaw);
    if (!happened) {
      rejects.push({ row: rowNum, reason: `date "${dateRaw}" not recognised (use dd/mm/yyyy)` });
      continue;
    }
    const description = mapped(row, mapping, "description").trim();
    if (!description) {
      rejects.push({ row: rowNum, reason: "work description is empty" });
      continue;
    }
    const mileageRaw = mapped(row, mapping, "mileage").replace(/[,\s]/g, "");
    const mileage = mileageRaw ? Number(mileageRaw) : null;
    if (mileage !== null && (!Number.isInteger(mileage) || mileage < 0 || mileage > 2_000_000)) {
      rejects.push({ row: rowNum, reason: `mileage "${mileageRaw}" invalid` });
      continue;
    }
    valid.push({
      row: rowNum,
      registration: normalizeReg(reg),
      happened_on: happened,
      description: description.slice(0, 2000),
      mileage,
      total: parseMoney(mapped(row, mapping, "total")),
    });
  }
  return { valid, rejects };
}

export type InvoiceImportRow = {
  row: number;
  invoice_number: string;
  issued_on: string; // ISO date
  total: number;
  customer_email: string | null;
  registration: string | null; // normalised
  status: string | null;
  description: string | null;
};

export function validateInvoiceRows(
  rows: Record<string, string>[],
  mapping: ColumnMapping,
): { valid: InvoiceImportRow[]; rejects: RowReject[] } {
  const valid: InvoiceImportRow[] = [];
  const rejects: RowReject[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;
    const number = mapped(row, mapping, "invoice_number").trim();
    if (!number) {
      rejects.push({ row: rowNum, reason: "invoice number is empty" });
      continue;
    }
    const dateRaw = mapped(row, mapping, "issued_on");
    const issued = parseDateFlexible(dateRaw);
    if (!issued) {
      rejects.push({ row: rowNum, reason: `invoice date "${dateRaw}" not recognised (use dd/mm/yyyy)` });
      continue;
    }
    const totalRaw = mapped(row, mapping, "total");
    const total = parseMoney(totalRaw);
    if (total === null) {
      rejects.push({ row: rowNum, reason: `total "${totalRaw}" is not an amount` });
      continue;
    }
    const email = mapped(row, mapping, "customer_email").trim().toLowerCase();
    const reg = mapped(row, mapping, "registration").trim();
    if (!email && !reg) {
      rejects.push({ row: rowNum, reason: "no customer email or registration to match the invoice to" });
      continue;
    }
    valid.push({
      row: rowNum,
      invoice_number: number.slice(0, 60),
      issued_on: issued,
      total,
      customer_email: email || null,
      registration: reg ? normalizeReg(reg) : null,
      status: mapped(row, mapping, "status").trim().slice(0, 40) || null,
      description: mapped(row, mapping, "description").trim().slice(0, 2000) || null,
    });
  }
  return { valid, rejects };
}

export function validateReminderRows(
  rows: Record<string, string>[],
  mapping: ColumnMapping,
): { valid: ReminderRow[]; rejects: RowReject[] } {
  const valid: ReminderRow[] = [];
  const rejects: RowReject[] = [];
  outer: for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;
    const reg = mapped(row, mapping, "registration").trim();
    if (!reg) {
      rejects.push({ row: rowNum, reason: "registration is empty" });
      continue;
    }
    const dates: Record<string, string | null> = {};
    for (const key of ["mot_expiry", "service_due", "tax_due_date"] as const) {
      const raw = mapped(row, mapping, key);
      if (!raw.trim()) {
        dates[key] = null;
        continue;
      }
      const parsed = parseDateFlexible(raw);
      if (!parsed) {
        rejects.push({ row: rowNum, reason: `${key.replace(/_/g, " ")} "${raw}" not recognised` });
        continue outer;
      }
      dates[key] = parsed;
    }
    if (!dates.mot_expiry && !dates.service_due && !dates.tax_due_date) {
      rejects.push({ row: rowNum, reason: "no reminder dates on the row" });
      continue;
    }
    valid.push({
      row: rowNum,
      registration: normalizeReg(reg),
      mot_expiry: dates.mot_expiry,
      service_due: dates.service_due,
      tax_due_date: dates.tax_due_date,
    });
  }
  return { valid, rejects };
}
