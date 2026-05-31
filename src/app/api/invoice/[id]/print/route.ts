import { type NextRequest, NextResponse } from "next/server";
import { getStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildInvoicePrintHtml } from "@/lib/invoice-print-html";

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

  const itemsRes = invoice.job_id
    ? await admin
        .from("job_items")
        .select("description, type, quantity, unit_price")
        .eq("job_id", invoice.job_id)
        .order("created_at", { ascending: true })
    : { data: [] };
  const items = (itemsRes.data ?? []) as { description: string; type: string; quantity: number; unit_price: number }[];

  const contactLine = [org?.phone, ctx.user.email].filter(Boolean).join(" · ");

  const html = buildInvoicePrintHtml({
    invoice,
    items,
    org: {
      name: org?.name ?? ctx.organization.name,
      logo_url: org?.logo_url ?? null,
      primary_color: org?.primary_color ?? null,
    },
    contactLine,
  });

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
