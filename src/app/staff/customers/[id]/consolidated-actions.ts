"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { hasPermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { nextDocumentNumber } from "@/lib/document-numbers";
import { pushInvoiceToAccounting } from "@/lib/accounting/sync";
import { logAudit } from "@/lib/audit";

// Consolidated month-end invoicing (#504 PR 3). One invoice per account for
// the period's completed, uninvoiced jobs at the ACTIVE branch (invoice
// numbering and identity are per-branch) — line per job, per-line VAT from
// the job's own lines (#514 maths). Idempotent: invoice_jobs.unique(job_id)
// makes double-billing structurally impossible.

type Admin = ReturnType<typeof createAdminClient>;

export type RaiseConsolidatedResult =
  | { error: string }
  | { success: true; invoiceId: string; invoiceNumber: string; jobCount: number; total: number };

type BillableJob = { id: string; net: number; vat: number };

// Completed jobs in [fromIso, toIso) with no individual invoice and no
// consolidated membership. NB the jobs→invoices embed MUST be hinted —
// double join path since invoice_jobs (#504 PR 2 gotcha).
async function billableJobs(
  admin: Admin,
  customerId: string,
  locationId: string,
  fromIso: string,
  toIso: string,
): Promise<BillableJob[]> {
  const { data } = await admin
    .from("jobs")
    .select(
      "id, completed_at, invoices!invoices_job_id_fkey(id), invoice_jobs(id), items:job_items(quantity, unit_price, vat_rate)",
    )
    .eq("customer_id", customerId)
    .eq("location_id", locationId)
    .eq("status", "complete")
    .gte("completed_at", fromIso)
    .lt("completed_at", toIso);
  type Row = {
    id: string;
    invoices: { id: string }[] | null;
    invoice_jobs: { id: string }[] | null;
    items: { quantity: number; unit_price: number; vat_rate: number | null }[] | null;
  };
  const out: BillableJob[] = [];
  for (const j of ((data ?? []) as unknown as Row[])) {
    if ((j.invoices ?? []).length > 0 || (j.invoice_jobs ?? []).length > 0) continue;
    let net = 0;
    let vat = 0;
    for (const it of j.items ?? []) {
      const line = (Number(it.quantity) || 0) * (Number(it.unit_price) || 0);
      net += line;
      vat += line * ((Number(it.vat_rate) || 0) / 100);
    }
    net = Math.round(net * 100) / 100;
    vat = Math.round(vat * 100) / 100;
    if (net > 0) out.push({ id: j.id, net, vat });
  }
  return out;
}

export async function raiseConsolidatedInvoice(
  customerId: string,
  args: { fromIso: string; toIso: string },
): Promise<RaiseConsolidatedResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "invoices")) return { error: "Permission denied." };
  const admin = createAdminClient();

  const { data: custRow } = await admin
    .from("customers")
    .select("id, organization_id, account_customer, consolidated_billing, payment_terms_days")
    .eq("id", customerId)
    .maybeSingle();
  const cust = custRow as {
    id: string;
    organization_id: string;
    account_customer: boolean;
    consolidated_billing: boolean;
    payment_terms_days: number;
  } | null;
  if (!cust || cust.organization_id !== ctx.organization.id) return { error: "Customer not found." };
  if (!cust.account_customer || !cust.consolidated_billing) {
    return { error: "Enable consolidated billing on this account first." };
  }

  const jobs = await billableJobs(admin, customerId, ctx.location.id, args.fromIso, args.toIso);
  if (jobs.length === 0) return { error: "No completed, unbilled jobs at this branch in that period." };

  const subtotal = Math.round(jobs.reduce((s, j) => s + j.net, 0) * 100) / 100;
  const vatAmount = Math.round(jobs.reduce((s, j) => s + j.vat, 0) * 100) / 100;
  const total = Math.round((subtotal + vatAmount) * 100) / 100;

  const allocated = await nextDocumentNumber(admin, ctx.location.id, "invoice");
  if ("error" in allocated) return { error: `Could not allocate an invoice number: ${allocated.error}` };

  const today = new Date();
  const due = new Date(today);
  due.setDate(due.getDate() + Number(cust.payment_terms_days ?? 30));

  const { data: invoice, error: invErr } = await admin
    .from("invoices")
    .insert({
      location_id: ctx.location.id,
      customer_id: customerId,
      job_id: null,
      invoice_number: allocated.number,
      status: "draft",
      subtotal,
      // Consolidated invoices carry per-line VAT summed from the jobs; the
      // header rate is display-only, so store the effective rate.
      vat_rate: subtotal > 0 ? Math.round((vatAmount / subtotal) * 10000) / 100 : 20,
      vat_amount: vatAmount,
      total,
      issued_at: today.toISOString().split("T")[0],
      due_at: due.toISOString().split("T")[0],
      notes: `Consolidated invoice · ${jobs.length} job${jobs.length === 1 ? "" : "s"}`,
    })
    .select("id")
    .single();
  if (invErr || !invoice) return { error: invErr?.message ?? "Could not create the invoice." };

  const { error: linkErr } = await admin.from("invoice_jobs").insert(
    jobs.map((j) => ({ invoice_id: invoice.id, job_id: j.id, amount: j.net })),
  );
  if (linkErr) {
    // unique(job_id) tripped (raced with another run) or similar — undo.
    await admin.from("invoices").delete().eq("id", invoice.id);
    return { error: `Could not link jobs (already billed elsewhere?): ${linkErr.message}` };
  }

  await admin.from("jobs").update({ status: "invoiced" }).in("id", jobs.map((j) => j.id));

  // Fire-and-forget: consolidated invoices previously never reached the
  // accounting provider at raise time (only via the manual retry button,
  // and then as a wrong single standard-rated line — see sync.ts's
  // consolidatedSalesLines for the per-job treatment-split push).
  pushInvoiceToAccounting(invoice.id).catch((err) =>
    console.error("[consolidated] accounting push failed", err),
  );

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "invoice.consolidated",
    entityType: "invoice",
    entityId: invoice.id,
    metadata: { customer_id: customerId, jobs: jobs.length, total, from: args.fromIso, to: args.toIso },
  });

  revalidatePath(`/staff/customers/${customerId}`);
  revalidatePath("/staff/invoices");
  return { success: true, invoiceId: invoice.id, invoiceNumber: allocated.number, jobCount: jobs.length, total };
}

export type MonthEndResult =
  | { error: string }
  | { success: true; raised: { customerName: string; invoiceNumber: string; jobCount: number; total: number }[]; skipped: number };

// Org-wide month end for the ACTIVE branch: every consolidated account with
// billable jobs in the period gets one invoice. Accounts without billable
// work are skipped silently.
export async function runMonthEnd(args: { fromIso: string; toIso: string }): Promise<MonthEndResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "invoices")) return { error: "Permission denied." };
  const admin = createAdminClient();

  const { data: accounts } = await admin
    .from("customers")
    .select("id, full_name")
    .eq("organization_id", ctx.organization.id)
    .eq("account_customer", true)
    .eq("consolidated_billing", true);

  const raised: { customerName: string; invoiceNumber: string; jobCount: number; total: number }[] = [];
  let skipped = 0;
  for (const acct of ((accounts ?? []) as { id: string; full_name: string | null }[])) {
    const result = await raiseConsolidatedInvoice(acct.id, args);
    if ("error" in result) {
      skipped++;
      continue;
    }
    raised.push({
      customerName: acct.full_name ?? "Account customer",
      invoiceNumber: result.invoiceNumber,
      jobCount: result.jobCount,
      total: result.total,
    });
  }

  revalidatePath("/staff/invoices");
  return { success: true, raised, skipped };
}
