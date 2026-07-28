import { getStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import {
  buildCreditNoteLines,
  orgIsVatRegistered,
  salesLinesForInvoiceRow,
} from "@/lib/accounting/sync";
import { vatRateFor } from "@/lib/vat";

// Accounting-import sales export (MTD digital-link fallback,
// docs/mtd-readiness.md WS5). VAT Notice 700/22 names CSV import/export a
// valid digital link — so an org NOT connected to Xero/QuickBooks/Sage can
// still move its sales record into whatever package its accountant uses
// without re-keying (which is the banned, non-compliant path). One row per
// LINE with the same description/net/tax treatment the API sync would have
// pushed, plus customer names and dates, so the file imports cleanly and a
// bridging tool can compute Box 1/6 from it.
//
// GET /staff/settings/export/accounting?from=YYYY-MM-DD&to=YYYY-MM-DD
// Optional date range filters on issued_at (credit notes: created_at).

const MAX_DOCS = 5000;

const HEADER = [
  "doc_type",
  "doc_number",
  "doc_date",
  "due_date",
  "status",
  "customer_name",
  "customer_email",
  "line_description",
  "quantity",
  "unit_amount_net",
  "line_net",
  "tax_treatment",
  "vat_rate_pct",
];

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function ratePctOf(treatment: string): number {
  return treatment === "standard" ? vatRateFor("standard") : 0;
}

export async function GET(req: Request) {
  const ctx = await getStaffContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  if (ctx.orgRole !== "owner" && ctx.orgRole !== "admin") {
    return new Response("Forbidden", { status: 403 });
  }

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const dateOk = (s: string | null) => s === null || /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (!dateOk(from) || !dateOk(to)) return new Response("Bad date", { status: 400 });

  const admin = createAdminClient();
  const orgVatRegistered = await orgIsVatRegistered(ctx.organization.id);

  let invQuery = admin
    .from("invoices")
    .select(
      "id, invoice_number, status, subtotal, vat_amount, discount_amount, discount_description, membership_credit_amount, membership_credit_description, issued_at, due_at, job_id, booking_id, customer:customers(full_name, email)",
    )
    .eq("organization_id", ctx.organization.id)
    .not("is_demo", "is", true)
    .order("issued_at", { ascending: true })
    .limit(MAX_DOCS);
  if (from) invQuery = invQuery.gte("issued_at", from);
  if (to) invQuery = invQuery.lte("issued_at", to);
  const { data: invData, error: invErr } = await invQuery;
  if (invErr) return new Response(`Export failed: ${invErr.message}`, { status: 500 });

  type Inv = {
    id: string;
    invoice_number: string;
    status: string;
    subtotal: number;
    vat_amount: number;
    discount_amount: number;
    discount_description: string | null;
    membership_credit_amount: number;
    membership_credit_description: string | null;
    issued_at: string;
    due_at: string;
    job_id: string | null;
    booking_id: string | null;
    customer: { full_name: string | null; email: string | null } | null;
  };
  const invoices = (invData ?? []) as unknown as Inv[];

  let cnQuery = admin
    .from("credit_notes")
    .select("id, credit_number, reason, subtotal, vat_amount, created_at, customer:customers(full_name, email)")
    .eq("organization_id", ctx.organization.id)
    .order("created_at", { ascending: true })
    .limit(MAX_DOCS);
  if (from) cnQuery = cnQuery.gte("created_at", from);
  if (to) cnQuery = cnQuery.lte("created_at", `${to}T23:59:59.999Z`);
  const { data: cnData, error: cnErr } = await cnQuery;
  if (cnErr) return new Response(`Export failed: ${cnErr.message}`, { status: 500 });

  type Cn = {
    id: string;
    credit_number: string | null;
    reason: string | null;
    subtotal: number;
    vat_amount: number | null;
    created_at: string;
    customer: { full_name: string | null; email: string | null } | null;
  };
  const creditNotes = (cnData ?? []) as unknown as Cn[];

  const lines: string[] = [HEADER.join(",")];
  const push = (cells: unknown[]) => lines.push(cells.map(csvCell).join(","));

  for (const inv of invoices) {
    const salesLines = await salesLinesForInvoiceRow(inv, orgVatRegistered);
    for (const l of salesLines) {
      push([
        "invoice",
        inv.invoice_number,
        inv.issued_at,
        inv.due_at,
        inv.status,
        inv.customer?.full_name ?? "",
        inv.customer?.email ?? "",
        l.description,
        l.quantity,
        l.unitAmount,
        Math.round(l.quantity * l.unitAmount * 100) / 100,
        l.taxTreatment,
        ratePctOf(l.taxTreatment),
      ]);
    }
  }

  for (const cn of creditNotes) {
    const cnLines = buildCreditNoteLines({
      description: cn.reason ? `Refund — ${cn.reason}` : `Refund ${cn.credit_number ?? ""}`.trim(),
      subtotal: Number(cn.subtotal),
      vatAmount: Number(cn.vat_amount ?? 0),
      orgVatRegistered,
    });
    for (const l of cnLines) {
      push([
        "credit_note",
        cn.credit_number ?? cn.id,
        cn.created_at.slice(0, 10),
        "",
        "issued",
        cn.customer?.full_name ?? "",
        cn.customer?.email ?? "",
        l.description,
        l.quantity,
        // Credit-note lines export as negatives so a summed import nets off.
        -l.unitAmount,
        -(Math.round(l.quantity * l.unitAmount * 100) / 100),
        l.taxTreatment,
        ratePctOf(l.taxTreatment),
      ]);
    }
  }

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "org.data_export",
    entityType: "organization",
    entityId: ctx.organization.id,
    metadata: {
      entity: "accounting_sales",
      from,
      to,
      invoices: invoices.length,
      credit_notes: creditNotes.length,
    },
  });

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `${ctx.organization.slug ?? "org"}-sales-${from ?? "all"}-to-${to ?? stamp}.csv`;
  return new Response(lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
