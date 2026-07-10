"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { hasPermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { emailSchema, nameSchema, phoneSchema, parseOrError } from "@/lib/validation";
import { normalizeRegistration, validateRegistration } from "@/lib/registration";
import { z } from "zod";
import {
  parseCsvText,
  autoMap,
  missingRequired,
  validateHistoryRows,
  validateReminderRows,
  parseDateFlexible,
  TARGET_FIELDS,
  type ColumnMapping,
  type ImportKind,
  type RowReject,
} from "@/lib/import-engine";

// Import wizard actions (#505 PR 2): analyze = parse + map + validate +
// dry-run counts (no writes); commit = re-validate then write, batch-tracked.
// The file rides along on both calls — server actions can't hold it between
// requests, and re-validating at commit is the all-or-nothing guarantee.

const MAX_FILE_BYTES = 2_000_000;
const MAX_ROWS = 5000;
const ALLOWED_MIME = new Set(["text/csv", "text/plain", "application/vnd.ms-excel", "application/octet-stream", ""]);

export type AnalyzeResult =
  | { error: string }
  | {
      headers: string[];
      mapping: ColumnMapping;
      missing: string[];
      totalRows: number;
      /** Row-level rejects with reasons (dry-run). */
      rejects: RowReject[];
      /** Kind-specific counts of what a commit would do. */
      counts: Record<string, number>;
    };

export type CommitResult =
  | { error: string }
  | { batchId: string; imported: number; rejected: number; counts: Record<string, number>; rejects: RowReject[] };

function readMapping(raw: string | null, headers: string[], kind: ImportKind): ColumnMapping {
  if (!raw) return autoMap(headers, kind);
  try {
    const parsed = JSON.parse(raw) as ColumnMapping;
    const clean: ColumnMapping = {};
    for (const field of TARGET_FIELDS[kind]) {
      const src = parsed[field.key];
      clean[field.key] = typeof src === "string" && headers.includes(src) ? src : null;
    }
    return clean;
  } catch {
    return autoMap(headers, kind);
  }
}

async function loadFile(formData: FormData): Promise<{ error: string } | { text: string; filename: string }> {
  const file = formData.get("file") as File | null;
  if (!file) return { error: "No file uploaded." };
  if (!file.name.toLowerCase().endsWith(".csv")) return { error: "File must be a .csv." };
  if (!ALLOWED_MIME.has(file.type)) return { error: "File must be a .csv." };
  if (file.size > MAX_FILE_BYTES) return { error: "File is too large (max 2 MB)." };
  return { text: await file.text(), filename: file.name };
}

const kindSchema = z.enum(["customers", "history", "reminders"]);

// Resolve normalised registrations to vehicle ids. Stored registrations mix
// formats ("AB19 CDE" vs "AB19CDE"), so match space-insensitively: page the
// org's vehicles and normalise in JS rather than trusting an exact .in().
async function resolveVehicles(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
  regs: string[],
): Promise<Map<string, string>> {
  const wanted = new Set(regs);
  const map = new Map<string, string>();
  const PAGE = 1000;
  for (let from = 0; from < 20_000; from += PAGE) {
    const { data } = await admin
      .from("vehicles")
      .select("id, registration")
      .eq("organization_id", organizationId)
      .range(from, from + PAGE - 1);
    const rows = (data ?? []) as { id: string; registration: string }[];
    for (const v of rows) {
      const norm = normalizeRegistration(v.registration);
      if (wanted.has(norm) && !map.has(norm)) map.set(norm, v.id);
    }
    if (rows.length < PAGE) break;
  }
  return map;
}

const customersRowSchema = z.object({ full_name: nameSchema, email: emailSchema, phone: phoneSchema });

type Prepared =
  | { error: string }
  | {
      kind: ImportKind;
      filename: string;
      headers: string[];
      mapping: ColumnMapping;
      missing: string[];
      totalRows: number;
      rejects: RowReject[];
      counts: Record<string, number>;
      // Kind payloads, ready to write.
      history: { vehicle_id: string; happened_on: string; mileage: number | null; description: string; total: number | null }[];
      reminders: { vehicle_id: string; mot_expiry: string | null; service_due: string | null; tax_due_date: string | null }[];
      customers: { full_name: string; email: string; phone: string | null; raw: Record<string, string> }[];
    };

// Shared parse→map→validate→resolve pipeline for analyze AND commit, so the
// commit can never write something the preview didn't show.
async function prepare(formData: FormData, ctx: Awaited<ReturnType<typeof requireStaffContext>>): Promise<Prepared> {
  const kindParse = kindSchema.safeParse(formData.get("kind"));
  if (!kindParse.success) return { error: "Unknown import kind." };
  const kind = kindParse.data;

  const loaded = await loadFile(formData);
  if ("error" in loaded) return loaded;
  const { headers, rows } = parseCsvText(loaded.text);
  if (rows.length === 0) return { error: "CSV is empty or has no data rows." };
  if (rows.length > MAX_ROWS) return { error: `Too many rows (max ${MAX_ROWS}). Split the file and try again.` };

  const mapping = readMapping(formData.get("mapping") as string | null, headers, kind);
  const missing = missingRequired(kind, mapping);
  const base = { kind, filename: loaded.filename, headers, mapping, missing, totalRows: rows.length };
  if (missing.length > 0) {
    return { ...base, rejects: [], counts: {}, history: [], reminders: [], customers: [] };
  }

  const admin = createAdminClient();

  if (kind === "history") {
    const { valid, rejects } = validateHistoryRows(rows, mapping);
    const vehicles = await resolveVehicles(admin, ctx.organization.id, valid.map((r) => r.registration));
    const found = valid.filter((r) => vehicles.has(r.registration));
    for (const r of valid) {
      if (!vehicles.has(r.registration)) {
        rejects.push({ row: r.row, reason: `no vehicle with registration ${r.registration} — import customers & vehicles first` });
      }
    }
    rejects.sort((a, b) => a.row - b.row);
    return {
      ...base,
      rejects,
      counts: { entries: found.length, vehicles: new Set(found.map((r) => r.registration)).size },
      history: found.map((r) => ({
        vehicle_id: vehicles.get(r.registration)!,
        happened_on: r.happened_on,
        mileage: r.mileage,
        description: r.description,
        total: r.total,
      })),
      reminders: [],
      customers: [],
    };
  }

  if (kind === "reminders") {
    const { valid, rejects } = validateReminderRows(rows, mapping);
    const vehicles = await resolveVehicles(admin, ctx.organization.id, valid.map((r) => r.registration));
    const found = valid.filter((r) => vehicles.has(r.registration));
    for (const r of valid) {
      if (!vehicles.has(r.registration)) {
        rejects.push({ row: r.row, reason: `no vehicle with registration ${r.registration} — import customers & vehicles first` });
      }
    }
    rejects.sort((a, b) => a.row - b.row);
    return {
      ...base,
      rejects,
      counts: {
        vehicles: found.length,
        mot_dates: found.filter((r) => r.mot_expiry).length,
        service_dates: found.filter((r) => r.service_due).length,
        tax_dates: found.filter((r) => r.tax_due_date).length,
      },
      history: [],
      reminders: found.map((r) => ({
        vehicle_id: vehicles.get(r.registration)!,
        mot_expiry: r.mot_expiry,
        service_due: r.service_due,
        tax_due_date: r.tax_due_date,
      })),
      customers: [],
    };
  }

  // customers
  const rejects: RowReject[] = [];
  const customers: { full_name: string; email: string; phone: string | null; raw: Record<string, string> }[] = [];
  rows.forEach((row, i) => {
    const rowNum = i + 2;
    const get = (key: string) => {
      const src = mapping[key];
      return src ? (row[src] ?? "").trim() : "";
    };
    const parsed = parseOrError(customersRowSchema, {
      full_name: get("full_name"),
      email: get("email"),
      phone: get("phone") || undefined,
    });
    if ("error" in parsed) {
      rejects.push({ row: rowNum, reason: parsed.error });
      return;
    }
    const regRaw = get("registration");
    if (regRaw) {
      const regError = validateRegistration(regRaw);
      if (regError) {
        rejects.push({ row: rowNum, reason: regError });
        return;
      }
    }
    customers.push({
      full_name: parsed.data.full_name,
      email: parsed.data.email,
      phone: parsed.data.phone ?? null,
      raw: {
        registration: regRaw,
        make: get("make"),
        model: get("model"),
        year: get("year"),
        mot_expiry: get("mot_expiry"),
        service_due: get("service_due"),
      },
    });
  });
  return {
    ...base,
    rejects,
    counts: { customers: new Set(customers.map((c) => c.email)).size, vehicles: customers.filter((c) => c.raw.registration).length },
    history: [],
    reminders: [],
    customers,
  };
}

export async function analyzeImport(formData: FormData): Promise<AnalyzeResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "customers")) return { error: "Permission denied." };
  const prep = await prepare(formData, ctx);
  if ("error" in prep) return prep;
  return {
    headers: prep.headers,
    mapping: prep.mapping,
    missing: prep.missing,
    totalRows: prep.totalRows,
    rejects: prep.rejects,
    counts: prep.counts,
  };
}

export async function commitImport(formData: FormData): Promise<CommitResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "customers")) return { error: "Permission denied." };
  const admin = createAdminClient();

  const prep = await prepare(formData, ctx);
  if ("error" in prep) return prep;
  if (prep.missing.length > 0) return { error: `Map the required columns first: ${prep.missing.join(", ")}.` };

  const overwrite = formData.get("overwrite") === "true";

  const { data: batch, error: batchErr } = await admin
    .from("import_batches")
    .insert({
      organization_id: ctx.organization.id,
      location_id: ctx.location.id,
      kind: prep.kind,
      filename: prep.filename,
      total_rows: prep.totalRows,
      rejected_rows: prep.rejects.length,
      created_by: ctx.user.id,
    })
    .select("id")
    .single();
  if (batchErr || !batch) return { error: batchErr?.message ?? "Could not open an import batch." };
  const batchId = batch.id as string;
  const fail = async (message: string): Promise<CommitResult> => {
    // All-or-nothing: remove anything the batch wrote, then the batch itself.
    await admin.from("vehicle_history_entries").delete().eq("import_batch_id", batchId);
    await admin.from("import_batches").delete().eq("id", batchId);
    return { error: `Import failed, nothing was saved: ${message}` };
  };

  let imported = 0;

  if (prep.kind === "history") {
    for (let i = 0; i < prep.history.length; i += 500) {
      const chunk = prep.history.slice(i, i + 500).map((e) => ({
        ...e,
        organization_id: ctx.organization.id,
        source: "import",
        import_batch_id: batchId,
      }));
      const { error } = await admin.from("vehicle_history_entries").insert(chunk);
      if (error) return fail(error.message);
      imported += chunk.length;
    }
  } else if (prep.kind === "reminders") {
    for (const r of prep.reminders) {
      // Fill blanks by default; overwrite only when explicitly asked.
      const { data: veh } = await admin
        .from("vehicles")
        .select("mot_expiry, service_due, tax_due_date")
        .eq("id", r.vehicle_id)
        .maybeSingle();
      const cur = veh as { mot_expiry: string | null; service_due: string | null; tax_due_date: string | null } | null;
      const patch: Record<string, string> = {};
      if (r.mot_expiry && (overwrite || !cur?.mot_expiry)) patch.mot_expiry = r.mot_expiry;
      if (r.service_due && (overwrite || !cur?.service_due)) patch.service_due = r.service_due;
      if (r.tax_due_date && (overwrite || !cur?.tax_due_date)) patch.tax_due_date = r.tax_due_date;
      if (Object.keys(patch).length === 0) continue;
      const { error } = await admin.from("vehicles").update(patch).eq("id", r.vehicle_id);
      if (error) return fail(error.message);
      imported++;
    }
  } else {
    // customers — same row semantics as the original importer, engine-mapped.
    const emailToId = new Map<string, string>();
    for (const c of prep.customers) {
      let customerId = emailToId.get(c.email);
      if (!customerId) {
        const { data: existing } = await admin
          .from("customers")
          .select("id")
          .eq("organization_id", ctx.organization.id)
          .eq("email", c.email)
          .maybeSingle();
        if (existing) {
          customerId = existing.id as string;
        } else {
          const { data, error } = await admin
            .from("customers")
            .insert({
              organization_id: ctx.organization.id,
              preferred_location_id: ctx.location.id,
              full_name: c.full_name,
              email: c.email,
              phone: c.phone,
            })
            .select("id")
            .single();
          if (error || !data) return fail(error?.message ?? "customer insert failed");
          customerId = data.id as string;
          imported++;
        }
        emailToId.set(c.email, customerId);
      }
      if (!c.raw.registration) continue;
      const year = c.raw.year ? parseInt(c.raw.year, 10) : NaN;
      const { error: vErr } = await admin.from("vehicles").insert({
        location_id: ctx.location.id,
        customer_id: customerId,
        registration: normalizeRegistration(c.raw.registration),
        make: c.raw.make || null,
        model: c.raw.model || null,
        year: !Number.isNaN(year) && year >= 1900 && year <= new Date().getFullYear() + 1 ? year : null,
        mot_expiry: parseDateFlexible(c.raw.mot_expiry),
        service_due: parseDateFlexible(c.raw.service_due),
      });
      // Duplicate reg = already imported; anything else is a real failure.
      if (vErr && vErr.code !== "23505") return fail(vErr.message);
    }
  }

  await admin.from("import_batches").update({ imported_rows: imported }).eq("id", batchId);

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "import.committed",
    entityType: "import_batch",
    entityId: batchId,
    metadata: { kind: prep.kind, imported, rejected: prep.rejects.length, total: prep.totalRows, filename: prep.filename },
  });

  revalidatePath("/staff/customers");
  return { batchId, imported, rejected: prep.rejects.length, counts: prep.counts, rejects: prep.rejects };
}
