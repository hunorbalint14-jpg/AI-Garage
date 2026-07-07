import { getStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

// Tenant data export (#455): owner/admin downloads the org's customers,
// vehicles or invoices as CSV or JSON. Data-portability builds trust on entry
// (and answers GDPR requests) — the exit path is the org's own data, org-wide,
// never another tenant's. Every export is audit-logged.

const ENTITIES = {
  customers: {
    table: "customers",
    columns:
      "id, full_name, email, phone, marketing_email_consent, marketing_sms_consent, consent_updated_at, preferred_location_id, fleet_company_id, anonymized_at, created_at",
  },
  vehicles: {
    table: "vehicles",
    columns:
      "id, registration, make, model, year, fuel_type, customer_id, location_id, mot_expiry, service_due, tax_due_date, last_mot_test_date, created_at",
  },
  invoices: {
    table: "invoices",
    columns:
      "id, invoice_number, status, subtotal, vat_rate, vat_amount, discount_amount, membership_credit_amount, total, issued_at, due_at, paid_at, customer_id, location_id, job_id, booking_id, created_at",
  },
} as const;

type Entity = keyof typeof ENTITIES;

const BATCH = 1000;
const MAX_ROWS = 100_000; // hard stop — no tenant is near this; guards runaway loops

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const lines = [columns.join(",")];
  for (const r of rows) lines.push(columns.map((c) => csvCell(r[c])).join(","));
  return lines.join("\r\n") + "\r\n";
}

export async function GET(req: Request) {
  const ctx = await getStaffContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  // Org-wide data → org-level roles only (branch staff can't bulk-export).
  if (ctx.orgRole !== "owner" && ctx.orgRole !== "admin") {
    return new Response("Forbidden", { status: 403 });
  }

  const url = new URL(req.url);
  const entityParam = url.searchParams.get("entity") ?? "";
  const format = url.searchParams.get("format") === "json" ? "json" : "csv";
  if (!(entityParam in ENTITIES)) return new Response("Unknown entity", { status: 400 });
  const entity = entityParam as Entity;
  const def = ENTITIES[entity];

  const admin = createAdminClient();
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; from < MAX_ROWS; from += BATCH) {
    // Literal casts keep tsc off the deep-instantiation cliff (dynamic table +
    // column strings); rows are treated as untyped records regardless.
    const { data, error } = await admin
      .from(def.table as "customers")
      .select(def.columns as "*")
      .eq("organization_id", ctx.organization.id)
      .order("created_at", { ascending: true })
      .range(from, from + BATCH - 1);
    if (error) return new Response(`Export failed: ${error.message}`, { status: 500 });
    const batch = (data ?? []) as unknown as Record<string, unknown>[];
    rows.push(...batch);
    if (batch.length < BATCH) break;
  }

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "org.data_export",
    entityType: "organization",
    entityId: ctx.organization.id,
    metadata: { entity, format, rows: rows.length },
  });

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `${ctx.organization.slug ?? "org"}-${entity}-${stamp}.${format}`;
  const columns = def.columns.split(",").map((c) => c.trim());
  const body =
    format === "json" ? JSON.stringify(rows, null, 2) : toCsv(rows, columns);

  return new Response(body, {
    headers: {
      "Content-Type": format === "json" ? "application/json" : "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
