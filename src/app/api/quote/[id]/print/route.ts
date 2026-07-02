import { type NextRequest, NextResponse } from "next/server";
import { getStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildQuotePrintHtml, type QuotePrintData, type QuotePrintItem } from "@/lib/quote-print-html";

export const runtime = "nodejs";

type PersonRef = { full_name: string | null; email: string | null; phone: string | null } | null;
type VehicleRef = { registration: string | null; make: string | null; model: string | null; year: number | null } | null;

type QuoteRow = {
  id: string;
  quote_type: "job" | "standalone";
  location_id: string;
  slug: string | null;
  status: string;
  title: string | null;
  customer_message: string | null;
  subtotal: number;
  vat_rate: number;
  vat_amount: number;
  total: number;
  created_at: string;
  sent_at: string | null;
  expires_at: string | null;
  revision_number: number;
  revision_note: string | null;
  deposit_required: boolean;
  deposit_pct: number | null;
  deposit_amount: number | null;
  customer: PersonRef;
  vehicle: VehicleRef;
  job: { customer: PersonRef; vehicle: VehicleRef } | null;
};

// Staff-side quote print/PDF — session-authenticated, mirrors
// /api/invoice/[id]/print. Customers use /quote/[slug]/print?t= instead.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getStaffContext();
  if (!ctx) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { id } = await params;
  const admin = createAdminClient();

  const [quoteRes, orgRes] = await Promise.all([
    admin
      .from("quotes")
      .select(
        "id, quote_type, location_id, slug, status, title, customer_message, subtotal, vat_rate, vat_amount, total, created_at, sent_at, expires_at, revision_number, revision_note, deposit_required, deposit_pct, deposit_amount, customer:customers(full_name, email, phone), vehicle:vehicles(registration, make, model, year), job:jobs(customer:customers(full_name, email, phone), vehicle:vehicles(registration, make, model, year))",
      )
      .eq("id", id)
      .maybeSingle(),
    admin
      .from("organizations")
      .select("name, phone, logo_url, primary_color")
      .eq("id", ctx.organization.id)
      .maybeSingle(),
  ]);

  const quote = quoteRes.data as unknown as QuoteRow | null;
  if (!quote || quote.location_id !== ctx.location.id) {
    return new NextResponse("Not found", { status: 404 });
  }

  const org = orgRes.data as { name: string; phone: string | null; logo_url: string | null; primary_color: string | null } | null;

  const { data: itemRows } = await admin
    .from("quote_items")
    .select("description, type, quantity, unit_price")
    .eq("quote_id", id)
    .order("sort_order");
  const items = (itemRows ?? []) as QuotePrintItem[];

  // A DVI (job) quote's customer + vehicle come from its parent job.
  const isJob = quote.quote_type === "job";
  const printData: QuotePrintData = {
    slug: quote.slug,
    status: quote.status,
    title: quote.title,
    customer_message: quote.customer_message,
    subtotal: Number(quote.subtotal),
    vat_rate: Number(quote.vat_rate),
    vat_amount: Number(quote.vat_amount),
    total: Number(quote.total),
    created_at: quote.created_at,
    sent_at: quote.sent_at,
    expires_at: quote.expires_at,
    revision_number: quote.revision_number ?? 1,
    revision_note: quote.revision_note,
    deposit_required: quote.deposit_required,
    deposit_pct: quote.deposit_pct,
    deposit_amount: quote.deposit_amount,
    customer: isJob ? quote.job?.customer ?? null : quote.customer,
    vehicle: isJob ? quote.job?.vehicle ?? null : quote.vehicle,
  };

  const contactLine = [org?.phone, ctx.user.email].filter(Boolean).join(" · ");

  const html = buildQuotePrintHtml({
    quote: printData,
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
