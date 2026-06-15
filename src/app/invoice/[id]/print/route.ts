import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildInvoicePrintHtml } from "@/lib/invoice-print-html";


type Invoice = {
  id: string;
  invoice_number: string;
  status: string;
  subtotal: number;
  vat_rate: number;
  vat_amount: number;
  total: number;
  discount_amount: number;
  discount_description: string | null;
  membership_credit_amount: number;
  membership_credit_description: string | null;
  issued_at: string;
  due_at: string;
  paid_at: string | null;
  notes: string | null;
  customer_id: string;
  job_id: string | null;
  customer: { full_name: string | null; email: string | null; phone: string | null } | null;
};

// Customer-facing print/PDF view. Mirrors the ownership checks in
// src/app/invoice/[id]/page.tsx (logged-in customer must own the invoice) and
// reuses the same A4 template as the staff print route via buildInvoicePrintHtml.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const slug = request.headers.get("x-tenant-slug");
  if (!slug) return new NextResponse("Not found", { status: 404 });

  const admin = createAdminClient();

  const { data: location } = (await admin
    .from("locations")
    .select("id, organization:organizations(id, name, phone, logo_url, primary_color)")
    .eq("slug", slug)
    .maybeSingle()) as {
    data: {
      id: string;
      organization: { id: string; name: string; phone: string | null; logo_url: string | null; primary_color: string | null } | null;
    } | null;
  };
  if (!location?.organization) return new NextResponse("Not found", { status: 404 });

  const { data: customer } = await admin
    .from("customers")
    .select("id")
    .eq("organization_id", location.organization.id)
    .eq("email", user.email ?? "")
    .maybeSingle();
  if (!customer) return new NextResponse("Not found", { status: 404 });

  const { data: inv } = await admin
    .from("invoices")
    .select("id, invoice_number, status, subtotal, vat_rate, vat_amount, total, discount_amount, discount_description, membership_credit_amount, membership_credit_description, issued_at, due_at, paid_at, notes, customer_id, job_id, customer:customers(full_name, email, phone)")
    .eq("id", id)
    .maybeSingle();

  const invoice = inv as Invoice | null;
  if (!invoice || invoice.customer_id !== customer.id) {
    return new NextResponse("Not found", { status: 404 });
  }

  const itemsRes = invoice.job_id
    ? await admin
        .from("job_items")
        .select("description, type, quantity, unit_price")
        .eq("job_id", invoice.job_id)
        .order("created_at", { ascending: true })
    : { data: [] };
  const items = (itemsRes.data ?? []) as { description: string; type: string; quantity: number; unit_price: number }[];

  const org = location.organization;

  const html = buildInvoicePrintHtml({
    invoice,
    items,
    org: { name: org.name, logo_url: org.logo_url, primary_color: org.primary_color },
    contactLine: org.phone ?? "",
  });

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
