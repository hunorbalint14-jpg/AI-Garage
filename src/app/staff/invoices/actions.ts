"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { tenantPayUrl } from "@/lib/stripe";
import { buildInvoiceHtml } from "@/lib/invoice-html";
import { pushInvoiceToXero, pushPaymentToXero } from "@/lib/xero-sync";

export type CreateInvoiceResult = { error: string } | { success: true; invoiceId: string };

export async function createInvoiceFromJob(jobId: string): Promise<CreateInvoiceResult> {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  const [jobRes, itemsRes] = await Promise.all([
    admin
      .from("jobs")
      .select("id, location_id, customer_id, status")
      .eq("id", jobId)
      .maybeSingle(),
    admin
      .from("job_items")
      .select("id, description, type, quantity, unit_price")
      .eq("job_id", jobId),
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

  // Fire-and-forget: push to Xero. Logs internally, never blocks the
  // staff response.
  pushInvoiceToXero(invoice.id).catch((err) =>
    console.error("[invoices/createInvoiceFromJob] xero push failed", err),
  );

  revalidatePath(`/staff/jobs/${jobId}`);
  revalidatePath("/staff/invoices");
  revalidatePath("/staff/revenue");
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
    admin
      .from("organizations")
      .select("name, phone, logo_url, primary_color, stripe_account_id, stripe_charges_enabled")
      .eq("id", ctx.organization.id)
      .maybeSingle(),
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

  const org = orgRes.data as {
    name: string;
    phone: string | null;
    logo_url: string | null;
    primary_color: string | null;
    stripe_account_id: string | null;
    stripe_charges_enabled: boolean | null;
  } | null;
  const garageName = org?.name ?? ctx.organization.name;
  const canPayOnline = !!org?.stripe_account_id && !!org?.stripe_charges_enabled;
  const payUrl = canPayOnline ? tenantPayUrl(invoice.id) : null;

  const html = buildInvoiceHtml({
    invoiceNumber: invoice.invoice_number,
    issuedAt: invoice.issued_at,
    dueAt: invoice.due_at,
    garageName,
    garagePhone: org?.phone ?? null,
    garageEmail: ctx.user.email ?? null,
    logoUrl: org?.logo_url ?? null,
    brandColor: org?.primary_color ?? "#1f2937",
    customerName: invoice.customer.full_name ?? "Customer",
    items: (itemsRes.data ?? []) as { description: string; type: string; quantity: number; unit_price: number }[],
    subtotal: invoice.subtotal,
    vatRate: invoice.vat_rate,
    vatAmount: invoice.vat_amount,
    total: invoice.total,
    notes: invoice.notes,
    payUrl,
  });

  const fmt = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);

  const payLine = payUrl ? `\nPay online: ${payUrl}\n` : "";
  const emailResult = await sendEmail({
    to: invoice.customer.email,
    subject: `Invoice ${invoice.invoice_number} from ${garageName} — ${fmt(invoice.total)} due ${new Date(invoice.due_at).toLocaleDateString("en-GB")}`,
    text: `Invoice ${invoice.invoice_number} from ${garageName}. Total: ${fmt(invoice.total)}. Due: ${new Date(invoice.due_at).toLocaleDateString("en-GB")}.${payLine}Please view this email in an HTML client for the full invoice.`,
    html,
  });

  if (!emailResult.success) return { error: emailResult.error };

  await admin.from("invoices").update({ status: "sent" }).eq("id", invoiceId);

  revalidatePath(`/staff/invoices/${invoiceId}`);
  revalidatePath("/staff/invoices");
  revalidatePath("/staff/revenue");
  return { success: true };
}

export async function markInvoicePaid(invoiceId: string): Promise<InvoiceActionResult> {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  const { data: invoice } = await admin
    .from("invoices")
    .select("id, total, location_id")
    .eq("id", invoiceId)
    .eq("location_id", ctx.location.id)
    .maybeSingle();
  if (!invoice) return { error: "Invoice not found." };

  const paidAt = new Date().toISOString();
  const { error } = await admin
    .from("invoices")
    .update({ status: "paid", paid_at: paidAt })
    .eq("id", invoiceId)
    .eq("location_id", ctx.location.id);

  if (error) return { error: error.message };

  // Sync the payment to Xero, fire-and-forget.
  pushPaymentToXero({
    invoiceId,
    amountPence: Math.round(Number(invoice.total) * 100),
    paymentDate: paidAt,
    reference: "Manual mark-as-paid",
  }).catch((err) =>
    console.error("[invoices/markInvoicePaid] xero push failed", err),
  );

  revalidatePath(`/staff/invoices/${invoiceId}`);
  revalidatePath("/staff/invoices");
  revalidatePath("/staff/revenue");
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
  revalidatePath("/staff/revenue");
  redirect("/staff/invoices");
}
