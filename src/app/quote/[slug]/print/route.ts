import { type NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyQuoteAccess } from "@/lib/quote-links";
import { buildQuotePrintHtml, type QuotePrintData, type QuotePrintItem } from "@/lib/quote-print-html";

export const runtime = "nodejs";

type PersonRef = { full_name: string | null; email: string | null; phone: string | null } | null;
type VehicleRef = { registration: string | null; make: string | null; model: string | null; year: number | null } | null;

type QuoteRow = {
  id: string;
  quote_type: "job" | "standalone";
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
  location: {
    name: string;
    organization: { name: string; phone: string | null; logo_url: string | null; primary_color: string | null } | null;
  } | null;
};

// Customer-side quote print/PDF — token-gated like the /quote/[slug] page
// itself (?t=<raw token>). Approved/declined quotes stay downloadable so the
// customer keeps a copy after responding; expiry is enforced by
// verifyQuoteAccess regardless of status.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const token = request.nextUrl.searchParams.get("t");

  const verify = await verifyQuoteAccess(slug, token, [
    "pending",
    "approved",
    "declined",
    "rebooked",
    "approved_after_close",
  ]);
  if (!verify.ok) {
    const status = verify.reason === "not_found" ? 404 : verify.reason === "bad_token" ? 401 : 410;
    return new NextResponse("Unavailable", { status });
  }

  const admin = createAdminClient();
  const { data } = await admin
    .from("quotes")
    .select(
      "id, quote_type, slug, status, title, customer_message, subtotal, vat_rate, vat_amount, total, created_at, sent_at, expires_at, revision_number, revision_note, deposit_required, deposit_pct, deposit_amount, customer:customers(full_name, email, phone), vehicle:vehicles(registration, make, model, year), job:jobs(customer:customers(full_name, email, phone), vehicle:vehicles(registration, make, model, year)), location:locations(name, organization:organizations!organization_id(name, phone, logo_url, primary_color))",
    )
    .eq("id", verify.quote.id)
    .maybeSingle();

  const quote = data as unknown as QuoteRow | null;
  if (!quote) return new NextResponse("Not found", { status: 404 });

  const { data: itemRows } = await admin
    .from("quote_items")
    .select("description, type, quantity, unit_price")
    .eq("quote_id", quote.id)
    .order("sort_order");
  const items = (itemRows ?? []) as QuotePrintItem[];

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

  const org = quote.location?.organization ?? null;
  const html = buildQuotePrintHtml({
    quote: printData,
    items,
    org: {
      name: org?.name ?? quote.location?.name ?? "Your garage",
      logo_url: org?.logo_url ?? null,
      primary_color: org?.primary_color ?? null,
    },
    contactLine: org?.phone ?? null,
  });

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
