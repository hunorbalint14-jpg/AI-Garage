import { createAdminClient } from "@/lib/supabase/admin";
import { verifyQuoteAccess, type QuoteVerifyReason } from "@/lib/quote-links";
import { createSignedReadUrl } from "@/lib/quote-storage";
import { logAudit } from "@/lib/audit";
import { QuoteResponse } from "./quote-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Org = { id: string; name: string; logo_url: string | null; primary_color: string | null };
type Customer = { full_name: string | null };
type Vehicle = { registration: string | null; make: string | null; model: string | null; year: number | null };

type FullQuote = {
  id: string;
  job_id: string;
  location_id: string;
  status: string;
  title: string | null;
  description: string | null;
  video_path: string;
  subtotal: number;
  vat_rate: number;
  vat_amount: number;
  total: number;
  expires_at: string;
  job: {
    customer: Customer | null;
    vehicle: Vehicle | null;
  } | null;
  location: {
    name: string;
    phone: string | null;
    organization: Org | null;
  } | null;
  items: {
    id: string;
    description: string;
    type: string;
    quantity: number;
    unit_price: number;
  }[];
};

function formatGBP(n: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
}

const REASON_COPY: Record<QuoteVerifyReason, { code: number; title: string; body: string }> = {
  not_found: { code: 404, title: "Quote not found", body: "This link doesn't point to a valid quote. Check the link or contact the garage." },
  bad_token: { code: 401, title: "Invalid link", body: "This link is invalid or has been tampered with. Contact the garage for a new one." },
  expired: { code: 410, title: "Link expired", body: "This quote has expired. Contact the garage if you'd still like to go ahead." },
  wrong_status: { code: 410, title: "Already responded", body: "You've already responded to this quote. Contact the garage for further questions." },
};

export default async function QuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { slug } = await params;
  const { t: token } = await searchParams;

  const verify = await verifyQuoteAccess(slug, token ?? null, ["pending"]);
  if (!verify.ok) return renderGate(verify.reason);

  const admin = createAdminClient();

  // Load full quote payload — RLS bypassed via admin client, already token-gated.
  const { data } = await admin
    .from("job_quotes")
    .select(
      "id, job_id, location_id, status, title, description, video_path, subtotal, vat_rate, vat_amount, total, expires_at, job:jobs(customer:customers(full_name), vehicle:vehicles(registration, make, model, year)), location:locations(name, phone, organization:organizations(id, name, logo_url, primary_color))",
    )
    .eq("id", verify.quote.id)
    .maybeSingle();

  const partial = data as Omit<FullQuote, "items"> | null;
  if (!partial) return renderGate("not_found");

  const { data: itemRows } = await admin
    .from("job_quote_items")
    .select("id, description, type, quantity, unit_price")
    .eq("quote_id", verify.quote.id)
    .order("sort_order");

  const quote: FullQuote = { ...partial, items: itemRows ?? [] };

  // Atomic view counter + first-view stamp. Fire-and-forget.
  void admin.rpc("job_quotes_increment_view", { p_id: quote.id });
  void logAudit({
    organizationId: quote.location?.organization?.id ?? null,
    action: "quote.view",
    entityType: "job_quote",
    entityId: quote.id,
    metadata: { job_id: quote.job_id },
  });

  const videoUrl = await createSignedReadUrl(quote.video_path, 1800);

  const org = quote.location?.organization;
  const garageName = org?.name ?? quote.location?.name ?? "Your garage";
  const customerName = quote.job?.customer?.full_name?.split(" ")[0] ?? "there";
  const vehicle = quote.job?.vehicle;
  const vehicleDesc = vehicle
    ? [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || vehicle.registration || "your vehicle"
    : "your vehicle";
  const primary = org?.primary_color || "#22c55e";

  return (
    <main
      className="min-h-screen w-full text-slate-900"
      style={{ background: "#f8fafc" }}
    >
      <header className="bg-white border-b">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
          {org?.logo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={org.logo_url} alt={garageName} className="h-10 w-auto" />
          )}
          <div>
            <div className="text-sm font-semibold">{garageName}</div>
            {quote.location?.phone && (
              <a href={`tel:${quote.location.phone}`} className="text-xs text-slate-500">{quote.location.phone}</a>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-6 flex flex-col gap-6">
        <section>
          <div className="text-xs font-mono uppercase tracking-wide text-slate-500 mb-1">Additional work found</div>
          <h1 className="text-2xl font-bold">{quote.title ?? "Quote for extra work"}</h1>
          <p className="text-sm text-slate-600 mt-1">
            Hi {customerName} — while working on <span className="font-mono">{vehicleDesc}</span> we found extra work that needs your approval before we continue.
          </p>
        </section>

        {videoUrl ? (
          <video
            controls
            preload="metadata"
            playsInline
            src={videoUrl}
            className="w-full rounded-lg border bg-black"
          />
        ) : (
          <div className="rounded-lg border bg-slate-100 p-8 text-center text-sm text-slate-500">
            Video unavailable. Contact the garage if you need to see what was found.
          </div>
        )}

        {quote.description && (
          <section className="rounded-lg border bg-white p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-1">What we found</div>
            <p className="text-sm whitespace-pre-wrap">{quote.description}</p>
          </section>
        )}

        <section className="rounded-lg border bg-white overflow-hidden">
          <div className="px-4 py-2 bg-slate-50 border-b text-xs font-medium uppercase tracking-wide text-slate-500">Quote</div>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Item</th>
                <th className="px-4 py-2 font-medium text-right">Qty</th>
                <th className="px-4 py-2 font-medium text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {quote.items.map((it) => (
                <tr key={it.id} className="border-t">
                  <td className="px-4 py-2">
                    <div>{it.description}</div>
                    <div className="text-xs text-slate-500 capitalize">{it.type}</div>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{it.quantity}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatGBP(it.quantity * it.unit_price)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-50 text-sm">
              <tr className="border-t">
                <td colSpan={2} className="px-4 py-1.5 text-right text-slate-500">Subtotal</td>
                <td className="px-4 py-1.5 text-right tabular-nums">{formatGBP(quote.subtotal)}</td>
              </tr>
              <tr>
                <td colSpan={2} className="px-4 py-1.5 text-right text-slate-500">VAT ({quote.vat_rate}%)</td>
                <td className="px-4 py-1.5 text-right tabular-nums">{formatGBP(quote.vat_amount)}</td>
              </tr>
              <tr className="border-t-2 font-bold">
                <td colSpan={2} className="px-4 py-2 text-right">Total</td>
                <td className="px-4 py-2 text-right tabular-nums" style={{ color: primary }}>{formatGBP(quote.total)}</td>
              </tr>
            </tfoot>
          </table>
        </section>

        <QuoteResponse slug={slug} token={token ?? ""} primaryColor={primary} />

        <p className="text-center text-xs text-slate-500">
          Quote expires {new Date(quote.expires_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}.
        </p>
      </div>
    </main>
  );
}

function renderGate(reason: QuoteVerifyReason) {
  const { title, body } = REASON_COPY[reason];
  return (
    <main className="min-h-screen w-full grid place-items-center bg-slate-50 px-4">
      <div className="max-w-md w-full rounded-lg border bg-white p-8 text-center">
        <h1 className="text-2xl font-bold mb-2">{title}</h1>
        <p className="text-sm text-slate-600">{body}</p>
      </div>
    </main>
  );
}
