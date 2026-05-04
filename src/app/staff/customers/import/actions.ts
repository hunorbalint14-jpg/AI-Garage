"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeRegistration, validateRegistration } from "@/lib/registration";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ImportResult =
  | { error: string }
  | { customersCreated: number; customersSkipped: number; vehiclesAdded: number; totalRows: number; errors: string[] };

function parseCSVLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      values.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  values.push(current);
  return values;
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = parseCSVLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = (values[idx] ?? "").trim(); });
    rows.push(row);
  }
  return rows;
}

export async function importCSV(formData: FormData): Promise<ImportResult> {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  const file = formData.get("file") as File | null;
  if (!file) return { error: "No file uploaded." };
  if (!file.name.endsWith(".csv")) return { error: "File must be a .csv." };

  const text = await file.text();
  const rows = parseCSV(text);
  if (!rows.length) return { error: "CSV is empty or has no data rows." };

  let customersCreated = 0;
  let customersSkipped = 0;
  let vehiclesAdded = 0;
  const errors: string[] = [];
  const emailToCustomerId = new Map<string, string>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;

    const fullName = row.full_name?.trim();
    const email = row.email?.trim().toLowerCase();
    const phone = row.phone?.trim() || null;

    if (!fullName) { errors.push(`Row ${rowNum}: full_name required`); continue; }
    if (!email || !EMAIL_RE.test(email)) { errors.push(`Row ${rowNum}: invalid email`); continue; }

    let customerId = emailToCustomerId.get(email);

    if (!customerId) {
      const { data: existing } = await admin
        .from("customers")
        .select("id")
        .eq("location_id", ctx.location.id)
        .eq("email", email)
        .maybeSingle();

      if (existing) {
        customerId = existing.id;
        customersSkipped++;
      } else {
        const { data, error } = await admin
          .from("customers")
          .insert({ location_id: ctx.location.id, full_name: fullName, email, phone })
          .select("id")
          .single();

        if (error) { errors.push(`Row ${rowNum}: ${error.message}`); continue; }
        customerId = data.id;
        customersCreated++;
      }

      emailToCustomerId.set(email, customerId!);
    }

    const regInput = row.registration?.trim();
    if (!regInput) continue;

    const regError = validateRegistration(regInput);
    if (regError) { errors.push(`Row ${rowNum}: ${regError}`); continue; }
    const registration = normalizeRegistration(regInput);

    const make = row.make?.trim() || null;
    const model = row.model?.trim() || null;
    const motExpiry = row.mot_expiry?.trim() || null;
    const serviceDue = row.service_due?.trim() || null;

    let year: number | null = null;
    const yearStr = row.year?.trim();
    if (yearStr) {
      const parsed = parseInt(yearStr, 10);
      const current = new Date().getFullYear();
      if (!Number.isNaN(parsed) && parsed >= 1900 && parsed <= current + 1) year = parsed;
    }

    const { error: vErr } = await admin.from("vehicles").insert({
      location_id: ctx.location.id,
      customer_id: customerId,
      registration, make, model, year,
      mot_expiry: motExpiry || null,
      service_due: serviceDue || null,
    });

    if (vErr) {
      if (vErr.code !== "23505") errors.push(`Row ${rowNum}: vehicle — ${vErr.message}`);
    } else {
      vehiclesAdded++;
    }
  }

  revalidatePath("/staff/customers");
  return { customersCreated, customersSkipped, vehiclesAdded, totalRows: rows.length, errors };
}
