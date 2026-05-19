import { type NextRequest, NextResponse } from "next/server";
import { getStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type Invoice = {
  id: string;
  invoice_number: string;
  status: string;
  subtotal: number;
  vat_rate: number;
  vat_amount: number;
  total: number;
  issued_at: string;
  due_at: string;
  paid_at: string | null;
  notes: string | null;
  location_id: string;
  job_id: string | null;
  customer: { full_name: string | null; email: string | null; phone: string | null } | null;
};

type OrgRow = {
  name: string;
  phone: string | null;
  logo_url: string | null;
  primary_color: string | null;
};

function fmt(n: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
}

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getStaffContext();
  if (!ctx) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { id } = await params;
  const admin = createAdminClient();

  const [invoiceRes, orgRes] = await Promise.all([
    admin
      .from("invoices")
      .select("id, invoice_number, status, subtotal, vat_rate, vat_amount, total, issued_at, due_at, paid_at, notes, location_id, job_id, customer:customers(full_name, email, phone)")
      .eq("id", id)
      .maybeSingle(),
    admin
      .from("organizations")
      .select("name, phone, logo_url, primary_color")
      .eq("id", ctx.organization.id)
      .maybeSingle(),
  ]);

  const invoice = invoiceRes.data as Invoice | null;
  if (!invoice || invoice.location_id !== ctx.location.id) {
    return new NextResponse("Not found", { status: 404 });
  }

  const org = orgRes.data as OrgRow | null;
  const brandColor = org?.primary_color ?? "#1f2937";

  const itemsRes = invoice.job_id
    ? await admin
        .from("job_items")
        .select("description, type, quantity, unit_price")
        .eq("job_id", invoice.job_id)
        .order("created_at", { ascending: true })
    : { data: [] };

  const items = (itemsRes.data ?? []) as { description: string; type: string; quantity: number; unit_price: number }[];

  const itemRows = items
    .map(
      (it) => `
      <tr>
        <td class="desc">${it.description}</td>
        <td class="type">${it.type}</td>
        <td class="num">${it.quantity}</td>
        <td class="num">${fmt(it.unit_price)}</td>
        <td class="num bold">${fmt(it.quantity * it.unit_price)}</td>
      </tr>`,
    )
    .join("");

  const logoHtml = org?.logo_url
    ? `<img src="${org.logo_url}" alt="${org.name}" style="max-height:60px;max-width:180px;object-fit:contain">`
    : `<span style="font-size:22px;font-weight:700;color:${brandColor}">${org?.name ?? ctx.organization.name}</span>`;

  const contactLine = [org?.phone, ctx.user.email].filter(Boolean).join(" · ");
  const garageName = org?.name ?? ctx.organization.name;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Invoice ${invoice.invoice_number} — ${garageName}</title>
<link rel="icon" href="/brand/icon/aigarage-favicon.svg" type="image/svg+xml">
<link rel="icon" href="/brand/icon/png/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="/brand/icon/png/apple-touch-icon.png" sizes="180x180">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 13px; color: #111827; background: #fff; padding: 40px 48px; max-width: 800px; margin: 0 auto; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; }
  .header-right { text-align: right; }
  .invoice-label { font-size: 28px; font-weight: 800; color: ${brandColor}; letter-spacing: -0.5px; }
  .invoice-number { font-size: 13px; color: #6b7280; margin-top: 4px; }
  .contact { font-size: 12px; color: #6b7280; margin-top: 6px; }
  .meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; margin-bottom: 32px; border-top: 2px solid ${brandColor}; border-bottom: 1px solid #e5e7eb; padding: 16px 0; }
  .meta-label { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: #9ca3af; margin-bottom: 4px; }
  .meta-value { font-size: 13px; font-weight: 600; }
  .meta-sub { font-size: 12px; color: #6b7280; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  thead th { background: #f9fafb; padding: 10px 12px; text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: #6b7280; border-bottom: 1px solid #e5e7eb; }
  tbody td { padding: 9px 12px; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
  tbody tr:last-child td { border-bottom: 2px solid #e5e7eb; }
  .type { color: #6b7280; text-transform: capitalize; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .bold { font-weight: 600; }
  tfoot td { padding: 8px 12px; }
  tfoot tr:last-child td { font-size: 15px; font-weight: 700; padding-top: 12px; border-top: 2px solid #111827; }
  .notes { font-size: 12px; color: #6b7280; margin-bottom: 24px; }
  .footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #9ca3af; }
  @media print {
    body { padding: 20px 28px; }
    @page { margin: 1cm; size: A4; }
  }
</style>
</head>
<body>
<div class="header">
  <div>${logoHtml}</div>
  <div class="header-right">
    <div class="invoice-label">INVOICE</div>
    <div class="invoice-number">${invoice.invoice_number}</div>
    ${contactLine ? `<div class="contact">${contactLine}</div>` : ""}
  </div>
</div>

<div class="meta">
  <div>
    <div class="meta-label">Bill to</div>
    <div class="meta-value">${invoice.customer?.full_name ?? "—"}</div>
    ${invoice.customer?.email ? `<div class="meta-sub">${invoice.customer.email}</div>` : ""}
    ${invoice.customer?.phone ? `<div class="meta-sub">${invoice.customer.phone}</div>` : ""}
  </div>
  <div>
    <div class="meta-label">Issued</div>
    <div class="meta-value">${fmtDate(invoice.issued_at)}</div>
  </div>
  <div>
    <div class="meta-label">Due</div>
    <div class="meta-value" style="color:${invoice.status !== "paid" && new Date(invoice.due_at) < new Date() ? "#dc2626" : "inherit"}">${fmtDate(invoice.due_at)}</div>
    ${invoice.paid_at ? `<div class="meta-sub" style="color:#16a34a">Paid ${fmtDate(invoice.paid_at)}</div>` : ""}
  </div>
</div>

<table>
  <thead>
    <tr>
      <th>Description</th>
      <th>Type</th>
      <th style="text-align:right">Qty</th>
      <th style="text-align:right">Unit price</th>
      <th style="text-align:right">Total</th>
    </tr>
  </thead>
  <tbody>${itemRows}</tbody>
  <tfoot>
    <tr>
      <td colspan="4" style="text-align:right;color:#6b7280">Subtotal</td>
      <td class="num">${fmt(invoice.subtotal)}</td>
    </tr>
    <tr>
      <td colspan="4" style="text-align:right;color:#6b7280">VAT (${invoice.vat_rate}%)</td>
      <td class="num">${fmt(invoice.vat_amount)}</td>
    </tr>
    <tr>
      <td colspan="4" style="text-align:right">Total due</td>
      <td class="num">${fmt(invoice.total)}</td>
    </tr>
  </tfoot>
</table>

${invoice.notes ? `<p class="notes">${invoice.notes}</p>` : ""}

<div class="footer">${garageName} · Generated by AI Garage</div>

<script>window.onload = () => window.print();</script>
</body>
</html>`;

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
