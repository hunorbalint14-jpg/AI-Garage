"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";

export type CreateInvoiceResult = { error: string } | { success: true; invoiceId: string };

function buildInvoiceHtml(args: {
  invoiceNumber: string;
  issuedAt: string;
  dueAt: string;
  garageName: string;
  garagePhone: string | null;
  garageEmail: string | null;
  customerName: string;
  items: { description: string; type: string; quantity: number; unit_price: number }[];
  subtotal: number;
  vatRate: number;
  vatAmount: number;
  total: number;
  notes: string | null;
}): string {
  const { invoiceNumber, issuedAt, dueAt, garageName, garagePhone, garageEmail, customerName, items, subtotal, vatRate, vatAmount, total, notes } = args;
  const fmt = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);

  const rows = items.map((it) => `
    <tr style="border-top:1px solid #e5e7eb">
      <td style="padding:8px 12px">${it.description}</td>
      <td style="padding:8px 12px;text-transform:capitalize;color:#6b7280">${it.type}</td>
      <td style="padding:8px 12px;text-align:right;font-family:monospace">${it.quantity}</td>
      <td style="padding:8px 12px;text-align:right;font-family:monospace">${fmt(it.unit_price)}</td>
      <td style="padding:8px 12px;text-align:right;font-family:monospace;font-weight:600">${fmt(it.quantity * it.unit_price)}</td>
    </tr>`).join("");

  const contact = [garagePhone, garageEmail].filter(Boolean).join(" · ");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;color:#111827;max-width:680px;margin:0 auto;padding:32px 24px">
<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px">
  <div>
    <h1 style="margin:0 0 4px;font-size:24px">${garageName}</h1>
    ${contact ? `<p style="margin:0;color:#6b7280;font-size:13px">${contact}</p>` : ""}
  </div>
  <div style="text-align:right">
    <p style="margin:0;font-size:20px;font-weight:700;color:#1f2937">INVOICE</p>
    <p style="margin:4px 0 0;font-size:13px;color:#6b7280">${invoiceNumber}</p>
  </div>
</div>

<div style="display:flex;gap:48px;margin-bottom:32px">
  <div>
    <p style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#9ca3af">Bill to</p>
    <p style="margin:0;font-weight:600">${customerName}</p>
  </div>
  <div>
    <p style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#9ca3af">Issued</p>
    <p style="margin:0">${new Date(issuedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</p>
  </div>
  <div>
    <p style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#9ca3af">Due</p>
    <p style="margin:0;font-weight:600">${new Date(dueAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</p>
  </div>
</div>

<table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:24px">
  <thead>
    <tr style="background:#f9fafb">
      <th style="padding:10px 12px;text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280">Description</th>
      <th style="padding:10px 12px;text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280">Type</th>
      <th style="padding:10px 12px;text-align:right;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280">Qty</th>
      <th style="padding:10px 12px;text-align:right;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280">Unit</th>
      <th style="padding:10px 12px;text-align:right;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280">Total</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
  <tfoot style="border-top:2px solid #e5e7eb">
    <tr>
      <td colspan="4" style="padding:8px 12px;text-align:right;color:#6b7280">Subtotal</td>
      <td style="padding:8px 12px;text-align:right;font-family:monospace">${fmt(subtotal)}</td>
    </tr>
    <tr>
      <td colspan="4" style="padding:8px 12px;text-align:right;color:#6b7280">VAT (${vatRate}%)</td>
      <td style="padding:8px 12px;text-align:right;font-family:monospace">${fmt(vatAmount)}</td>
    </tr>
    <tr style="background:#f9fafb">
      <td colspan="4" style="padding:10px 12px;text-align:right;font-weight:700;font-size:15px">Total</td>
      <td style="padding:10px 12px;text-align:right;font-family:monospace;font-weight:700;font-size:15px">${fmt(total)}</td>
    </tr>
  </tfoot>
</table>

${notes ? `<p style="color:#6b7280;font-size:13px">${notes}</p>` : ""}
<p style="color:#9ca3af;font-size:12px;margin-top:32px">Generated by Garage AI · ${garageName}</p>
</body></html>`;
}

export async function createInvoiceFromJob(jobId: string): Promise<CreateInvoiceResult> {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  const [jobRes, itemsRes, orgRes] = await Promise.all([
    admin
      .from("jobs")
      .select("id, location_id, customer_id, status")
      .eq("id", jobId)
      .maybeSingle(),
    admin
      .from("job_items")
      .select("id, description, type, quantity, unit_price")
      .eq("job_id", jobId),
    admin.from("organizations").select("name").eq("id", ctx.organization.id).maybeSingle(),
  ]);

  const job = jobRes.data as { id: string; location_id: string; customer_id: string | null; status: string } | null;
  if (!job || job.location_id !== ctx.location.id) return { error: "Job not found." };
  if (job.status === "open") return { error: "Complete the job before creating an invoice." };
  if (job.status === "invoiced") return { error: "Invoice already exists for this job." };

  const items = itemsRes.data ?? [];

  const subtotal = items.reduce((sum, i) => sum + Number(i.quantity) * Number(i.unit_price), 0);
  const vatRate = 20;
  const vatAmount = subtotal * (vatRate / 100);
  const total = subtotal + vatAmount;

  // Generate invoice number
  const { count } = await admin
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .eq("location_id", ctx.location.id);

  const invoiceNumber = `INV-${String((count ?? 0) + 1).padStart(4, "0")}`;
  const today = new Date();
  const due = new Date(today);
  due.setDate(due.getDate() + 30);

  const { data: invoice, error } = await admin
    .from("invoices")
    .insert({
      location_id: ctx.location.id,
      customer_id: job.customer_id,
      job_id: jobId,
      invoice_number: invoiceNumber,
      subtotal,
      vat_rate: vatRate,
      vat_amount: vatAmount,
      total,
      issued_at: today.toISOString().split("T")[0],
      due_at: due.toISOString().split("T")[0],
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  await admin.from("jobs").update({ status: "invoiced" }).eq("id", jobId);

  revalidatePath(`/staff/jobs/${jobId}`);
  revalidatePath("/staff/invoices");
  return { success: true, invoiceId: invoice.id };
}

export type InvoiceActionResult = { error: string } | { success: true };

export async function sendInvoice(invoiceId: string): Promise<InvoiceActionResult> {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  const [invoiceRes, orgRes] = await Promise.all([
    admin
      .from("invoices")
      .select("id, location_id, invoice_number, subtotal, vat_rate, vat_amount, total, issued_at, due_at, notes, customer:customers(full_name, email), job:jobs(id)")
      .eq("id", invoiceId)
      .maybeSingle(),
    admin.from("organizations").select("name, phone").eq("id", ctx.organization.id).maybeSingle(),
  ]);

  type InvoiceRow = {
    id: string; location_id: string; invoice_number: string;
    subtotal: number; vat_rate: number; vat_amount: number; total: number;
    issued_at: string; due_at: string; notes: string | null;
    customer: { full_name: string | null; email: string | null } | null;
    job: { id: string } | null;
  };

  const invoice = invoiceRes.data as InvoiceRow | null;
  if (!invoice || invoice.location_id !== ctx.location.id) return { error: "Invoice not found." };
  if (!invoice.customer?.email) return { error: "Customer has no email address." };

  const itemsRes = invoice.job
    ? await admin.from("job_items").select("description, type, quantity, unit_price").eq("job_id", invoice.job.id)
    : { data: [] };

  const org = orgRes.data;
  const garageName = org?.name ?? ctx.organization.name;

  const html = buildInvoiceHtml({
    invoiceNumber: invoice.invoice_number,
    issuedAt: invoice.issued_at,
    dueAt: invoice.due_at,
    garageName,
    garagePhone: org?.phone ?? null,
    garageEmail: ctx.user.email ?? null,
    customerName: invoice.customer.full_name ?? "Customer",
    items: (itemsRes.data ?? []) as { description: string; type: string; quantity: number; unit_price: number }[],
    subtotal: invoice.subtotal,
    vatRate: invoice.vat_rate,
    vatAmount: invoice.vat_amount,
    total: invoice.total,
    notes: invoice.notes,
  });

  const fmt = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);

  const emailResult = await sendEmail({
    to: invoice.customer.email,
    subject: `Invoice ${invoice.invoice_number} from ${garageName} — ${fmt(invoice.total)} due ${new Date(invoice.due_at).toLocaleDateString("en-GB")}`,
    text: `Invoice ${invoice.invoice_number} from ${garageName}. Total: ${fmt(invoice.total)}. Due: ${new Date(invoice.due_at).toLocaleDateString("en-GB")}. Please view this email in an HTML client for the full invoice.`,
    html,
  });

  if (!emailResult.success) return { error: emailResult.error };

  await admin.from("invoices").update({ status: "sent" }).eq("id", invoiceId);

  revalidatePath(`/staff/invoices/${invoiceId}`);
  revalidatePath("/staff/invoices");
  return { success: true };
}

export async function markInvoicePaid(invoiceId: string): Promise<InvoiceActionResult> {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  const { error } = await admin
    .from("invoices")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("id", invoiceId)
    .eq("location_id", ctx.location.id);

  if (error) return { error: error.message };

  revalidatePath(`/staff/invoices/${invoiceId}`);
  revalidatePath("/staff/invoices");
  return { success: true };
}

export async function deleteInvoice(invoiceId: string): Promise<InvoiceActionResult> {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  const { data: invoice } = await admin
    .from("invoices")
    .select("id, location_id, job_id, status")
    .eq("id", invoiceId)
    .maybeSingle();

  if (!invoice || invoice.location_id !== ctx.location.id) return { error: "Invoice not found." };
  if (invoice.status === "paid") return { error: "Cannot delete a paid invoice." };

  await admin.from("invoices").delete().eq("id", invoiceId);

  if (invoice.job_id) {
    await admin.from("jobs").update({ status: "complete" }).eq("id", invoice.job_id);
  }

  revalidatePath("/staff/invoices");
  redirect("/staff/invoices");
}
