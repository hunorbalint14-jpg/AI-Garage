"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { tenantPayUrl } from "@/lib/stripe";

export type CreateInvoiceResult = { error: string } | { success: true; invoiceId: string };

function buildInvoiceHtml(args: {
  invoiceNumber: string;
  issuedAt: string;
  dueAt: string;
  garageName: string;
  garagePhone: string | null;
  garageEmail: string | null;
  logoUrl: string | null;
  brandColor: string;
  customerName: string;
  items: { description: string; type: string; quantity: number; unit_price: number }[];
  subtotal: number;
  vatRate: number;
  vatAmount: number;
  total: number;
  notes: string | null;
  payUrl: string | null;
}): string {
  const { invoiceNumber, issuedAt, dueAt, garageName, garagePhone, garageEmail, logoUrl, brandColor, customerName, items, subtotal, vatRate, vatAmount, total, notes, payUrl } = args;
  const fmt = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
  const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  // Compute readable text color on brand background (luminance check)
  const onBrand = (() => {
    try {
      const h = brandColor.replace("#", "");
      const r = parseInt(h.slice(0, 2), 16);
      const g = parseInt(h.slice(2, 4), 16);
      const b = parseInt(h.slice(4, 6), 16);
      return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55 ? "#0e1014" : "#ffffff";
    } catch { return "#ffffff"; }
  })();

  const rows = items.map((it, idx) => `
    <tr${idx % 2 === 1 ? ' style="background:#fafafa"' : ""}>
      <td data-label="Item" style="padding:14px 16px;border-bottom:1px solid #f1f5f9;color:#111827">
        <div style="font-weight:600">${it.description}</div>
        <div style="font-size:12px;color:#6b7280;text-transform:capitalize;margin-top:2px">${it.type}</div>
      </td>
      <td data-label="Qty" style="padding:14px 16px;border-bottom:1px solid #f1f5f9;text-align:right;color:#374151;white-space:nowrap">${it.quantity}</td>
      <td data-label="Unit" style="padding:14px 16px;border-bottom:1px solid #f1f5f9;text-align:right;color:#374151;white-space:nowrap">${fmt(it.unit_price)}</td>
      <td data-label="Total" style="padding:14px 16px;border-bottom:1px solid #f1f5f9;text-align:right;color:#111827;font-weight:600;white-space:nowrap">${fmt(it.quantity * it.unit_price)}</td>
    </tr>`).join("");

  const contactLine = [garagePhone, garageEmail].filter(Boolean).join(" · ");

  const logoBlock = logoUrl
    ? `<img src="${logoUrl}" alt="${garageName}" height="48" style="display:block;max-height:48px;width:auto;border:0;outline:none">`
    : `<div style="font-size:22px;font-weight:700;color:#0f172a;letter-spacing:-0.01em">${garageName}</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Invoice ${invoiceNumber}</title>
<style>
  body { margin:0; padding:0; background:#f3f4f6; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; color:#111827; -webkit-font-smoothing:antialiased; }
  table { border-collapse:collapse; }
  a { color:${brandColor}; text-decoration:none; }
  @media only screen and (max-width: 600px) {
    .container { padding:16px !important; }
    .card { border-radius:0 !important; }
    .hero { padding:24px 20px !important; }
    .hero-name { font-size:18px !important; }
    .hero-amount { font-size:24px !important; }
    .items-wrap { padding:16px !important; }
    .items, .items thead, .items tbody, .items th, .items td, .items tr { display:block; }
    .items thead { display:none; }
    .items tr { padding:12px; border:1px solid #e5e7eb; border-radius:8px; margin-bottom:10px; }
    .items td { border:none !important; padding:4px 0 !important; text-align:left !important; }
    .items td:before { content: attr(data-label) ": "; font-weight:600; color:#6b7280; text-transform:uppercase; font-size:11px; letter-spacing:.04em; }
    .totals { padding:16px !important; }
    .meta-grid td { display:block !important; width:100% !important; padding:6px 0 !important; }
  }
</style>
</head>
<body>
<div class="container" style="max-width:680px;margin:0 auto;padding:32px 20px">
  <div class="card" style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.04)">

    <!-- Hero: brand color band with logo + invoice total -->
    <div class="hero" style="background:${brandColor};padding:32px 32px;color:${onBrand}">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td valign="top" style="padding:0">
            <div style="margin-bottom:12px">${logoBlock}</div>
            <div class="hero-name" style="font-size:20px;font-weight:600;color:${onBrand};opacity:0.95">${garageName}</div>
            ${contactLine ? `<div style="font-size:13px;margin-top:4px;color:${onBrand};opacity:0.8">${contactLine}</div>` : ""}
          </td>
          <td valign="top" align="right" style="padding:0;white-space:nowrap">
            <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.12em;opacity:0.75;color:${onBrand}">Invoice</div>
            <div style="font-size:15px;font-family:'SF Mono',Menlo,Consolas,monospace;margin-top:4px;color:${onBrand};opacity:0.95">${invoiceNumber}</div>
            <div class="hero-amount" style="font-size:28px;font-weight:700;margin-top:16px;color:${onBrand}">${fmt(total)}</div>
          </td>
        </tr>
      </table>
    </div>

    <!-- Meta: bill to + dates -->
    <div style="padding:24px 32px;border-bottom:1px solid #f1f5f9;background:#fafafa">
      <table role="presentation" class="meta-grid" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td valign="top" style="padding:0 12px 0 0;width:40%">
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;font-weight:600;margin-bottom:6px">Bill to</div>
            <div style="font-size:15px;font-weight:600;color:#111827">${customerName}</div>
          </td>
          <td valign="top" style="padding:0 12px;width:30%">
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;font-weight:600;margin-bottom:6px">Issued</div>
            <div style="font-size:14px;color:#374151">${fmtDate(issuedAt)}</div>
          </td>
          <td valign="top" style="padding:0 0 0 12px;width:30%">
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;font-weight:600;margin-bottom:6px">Due</div>
            <div style="font-size:14px;font-weight:600;color:#111827">${fmtDate(dueAt)}</div>
          </td>
        </tr>
      </table>
    </div>

    <!-- Items table -->
    <div class="items-wrap" style="padding:24px 32px">
      <table role="presentation" class="items" width="100%" cellpadding="0" cellspacing="0" border="0">
        <thead>
          <tr>
            <th align="left" style="padding:0 16px 10px;font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;font-weight:600;border-bottom:2px solid #e5e7eb">Item</th>
            <th align="right" style="padding:0 16px 10px;font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;font-weight:600;border-bottom:2px solid #e5e7eb">Qty</th>
            <th align="right" style="padding:0 16px 10px;font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;font-weight:600;border-bottom:2px solid #e5e7eb">Unit</th>
            <th align="right" style="padding:0 16px 10px;font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;font-weight:600;border-bottom:2px solid #e5e7eb">Total</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>

    <!-- Totals -->
    <div class="totals" style="padding:0 32px 24px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td></td>
          <td align="right" style="padding:0;width:240px">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="padding:8px 0;color:#6b7280;font-size:14px">Subtotal</td>
                <td align="right" style="padding:8px 0;color:#374151;font-size:14px">${fmt(subtotal)}</td>
              </tr>
              <tr>
                <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:14px">VAT (${vatRate}%)</td>
                <td align="right" style="padding:8px 0;border-bottom:1px solid #e5e7eb;color:#374151;font-size:14px">${fmt(vatAmount)}</td>
              </tr>
              <tr>
                <td style="padding:14px 0 0;font-weight:700;font-size:16px;color:#0f172a">Total due</td>
                <td align="right" style="padding:14px 0 0;font-weight:700;font-size:18px;color:${brandColor}">${fmt(total)}</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </div>

    ${payUrl ? `
    <div style="padding:24px 32px;background:#ffffff;border-top:1px solid #f1f5f9;text-align:center">
      <a href="${payUrl}" style="display:inline-block;background:${brandColor};color:${onBrand};font-weight:600;font-size:15px;text-decoration:none;padding:14px 28px;border-radius:8px;border:0">Pay ${fmt(total)} now →</a>
      <p style="font-size:11px;color:#9ca3af;margin:10px 0 0">Secure card payment via Stripe.</p>
    </div>` : ""}

    ${notes ? `
    <div style="padding:20px 32px;background:#fafafa;border-top:1px solid #f1f5f9;font-size:13px;color:#4b5563;line-height:1.6">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;font-weight:600;margin-bottom:6px">Notes</div>
      ${notes}
    </div>` : ""}

    <!-- Footer -->
    <div style="padding:20px 32px;background:#f9fafb;border-top:1px solid #f1f5f9;text-align:center">
      <div style="font-size:12px;color:#6b7280">Thank you for your business — ${garageName}</div>
      ${contactLine ? `<div style="font-size:12px;color:#9ca3af;margin-top:4px">${contactLine}</div>` : ""}
    </div>
  </div>

  <p style="text-align:center;font-size:11px;color:#9ca3af;margin:16px 0 0">
    Sent via AI Garage · <a href="https://ai-garage.co.uk/privacy" style="color:#9ca3af;text-decoration:underline">Privacy</a>
  </p>
</div>
</body>
</html>`;
}

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

  const { error } = await admin
    .from("invoices")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("id", invoiceId)
    .eq("location_id", ctx.location.id);

  if (error) return { error: error.message };

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
