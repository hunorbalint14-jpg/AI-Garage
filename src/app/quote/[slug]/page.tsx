import { createAdminClient } from "@/lib/supabase/admin";
import { verifyQuoteAccess, type QuoteVerifyReason, type QuoteSource } from "@/lib/quote-links";
import { createSignedReadUrl } from "@/lib/quote-storage";
import { getActiveFinanceConfig } from "@/lib/finance";
import { logAudit } from "@/lib/audit";
import { QuoteResponse } from "./quote-response";
import { SpreadTheCost } from "./spread-the-cost";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Org = { id: string; name: string; logo_url: string | null; primary_color: string | null; phone: string | null; quote_deposit_pct?: number | null };
type Customer = { full_name: string | null };
type Vehicle = { registration: string | null; make: string | null; model: string | null; year: number | null };

// Normalised shape — both job_quotes and standalone_quotes are reduced to this
// before the render so the JSX doesn't have to branch on source.
type NormalisedQuote = {
  id: string;
  source: QuoteSource;
  status: string;
  title: string | null;
  description: string | null;
  customer_message: string | null;
  video_path: string | null;
  subtotal: number;
  vat_rate: number;
  vat_amount: number;
  total: number;
  expires_at: string;
  customer: Customer | null;
  vehicle: Vehicle | null;
  org: Org | null;
  location_name: string | null;
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
  searchParams: Promise<{ t?: string; finance?: string }>;
}) {
  const { slug } = await params;
  const { t: token, finance: financeOutcome } = await searchParams;

  const verify = await verifyQuoteAccess(slug, token ?? null, ["pending"]);
  if (!verify.ok) {
    console.log("[quote-page] verify failed", {
      slug,
      reason: verify.reason,
      tokenPresent: !!token,
      tokenLen: token?.length ?? 0,
      tokenHead: token?.slice(0, 6) ?? null,
    });
    return renderGate(verify.reason);
  }

  const admin = createAdminClient();
  const quote = verify.quote.source === "standalone"
    ? await loadStandalone(admin, verify.quote.id)
    : await loadJobQuote(admin, verify.quote.id);

  if (!quote) return renderGate("not_found");

  // Fire-and-forget view counter + audit log.
  if (verify.quote.source === "standalone") {
    void admin.rpc("standalone_quotes_increment_view", { p_id: quote.id });
    void logAudit({
      organizationId: quote.org?.id ?? null,
      action: "standalone_quote.view",
      entityType: "standalone_quote",
      entityId: quote.id,
      metadata: {},
    });
  } else {
    void admin.rpc("job_quotes_increment_view", { p_id: quote.id });
    void logAudit({
      organizationId: quote.org?.id ?? null,
      action: "quote.view",
      entityType: "job_quote",
      entityId: quote.id,
      metadata: {},
    });
  }

  const videoUrl = quote.video_path ? await createSignedReadUrl(quote.video_path, 1800) : null;

  // "Spread the cost" shows when the org has a finance provider enabled and
  // the quote clears the configured minimum.
  const financeConfig = quote.org ? await getActiveFinanceConfig(quote.org.id) : null;
  const financeAvailable = !!financeConfig && Number(quote.total) >= financeConfig.minAmount;

  const org = quote.org;
  const garageName = org?.name ?? quote.location_name ?? "Your garage";
  const customerName = quote.customer?.full_name?.split(" ")[0] ?? "there";
  const vehicle = quote.vehicle;
  const vehicleDesc = vehicle
    ? [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || vehicle.registration || "your vehicle"
    : null;
  const primary = org?.primary_color || "#22c55e";

  const isStandalone = quote.source === "standalone";
  const eyebrow = isStandalone ? "Quote" : "Additional work found";
  const lede = isStandalone
    ? `Hi ${customerName} — here's the quote ${vehicleDesc ? `for ${vehicleDesc}` : ""} from ${garageName}. Review the items, then approve or decline below.`
    : `Hi ${customerName} — while working on ${vehicleDesc ?? "your vehicle"} we found extra work that needs your approval before we continue.`;

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
            {org?.phone && (
              <a href={`tel:${org.phone}`} className="text-xs text-slate-500">{org.phone}</a>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-6 flex flex-col gap-6">
        {financeOutcome === "success" && (
          <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
            Finance application complete — the garage has been notified.
          </div>
        )}
        {financeOutcome === "failed" && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            The finance application didn&apos;t complete. You can try again below or contact the garage.
          </div>
        )}
        <section>
          <div className="text-xs font-mono uppercase tracking-wide text-slate-500 mb-1">{eyebrow}</div>
          <h1 className="text-2xl font-bold">{quote.title ?? (isStandalone ? "Quote" : "Quote for extra work")}</h1>
          <p className="text-sm text-slate-600 mt-1">{lede}</p>
        </section>

        {videoUrl ? (
          <video
            controls
            preload="metadata"
            playsInline
            src={videoUrl}
            className="w-full rounded-lg border bg-black"
          />
        ) : isStandalone ? null : (
          <div className="rounded-lg border bg-slate-100 p-8 text-center text-sm text-slate-500">
            Video unavailable. Contact the garage if you need to see what was found.
          </div>
        )}

        {(isStandalone ? quote.customer_message : quote.description) && (
          <section className="rounded-lg border bg-white p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-1">
              {isStandalone ? "Note from the garage" : "What we found"}
            </div>
            <p className="text-sm whitespace-pre-wrap">{isStandalone ? quote.customer_message : quote.description}</p>
          </section>
        )}

        {/* Single-item quotes render a static summary here; multi-item quotes
            let QuoteResponse own the per-item checkbox UI + recalculating total. */}
        {quote.items.length === 1 && (
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
        )}

        {financeAvailable && financeOutcome !== "success" && (
          <SpreadTheCost
            slug={slug}
            token={token ?? ""}
            primaryColor={primary}
            totalFormatted={formatGBP(quote.total)}
          />
        )}

        <QuoteResponse
          slug={slug}
          token={token ?? ""}
          primaryColor={primary}
          items={quote.items}
          depositPct={Number(org?.quote_deposit_pct ?? 0)}
          showRebookCta={!isStandalone}
        />

        <p className="text-center text-xs text-slate-500">
          Quote expires {new Date(quote.expires_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}.
        </p>
      </div>
    </main>
  );
}

async function loadJobQuote(admin: ReturnType<typeof createAdminClient>, id: string): Promise<NormalisedQuote | null> {
  // Try the v2 select first (includes quote_deposit_pct), fall back to v1.
  const fullSelect =
    "id, location_id, status, title, description, video_path, subtotal, vat_rate, vat_amount, total, expires_at, job:jobs(customer:customers(full_name), vehicle:vehicles(registration, make, model, year)), location:locations(name, organization:organizations(id, name, logo_url, primary_color, phone, quote_deposit_pct))";
  const v1Select =
    "id, location_id, status, title, description, video_path, subtotal, vat_rate, vat_amount, total, expires_at, job:jobs(customer:customers(full_name), vehicle:vehicles(registration, make, model, year)), location:locations(name, organization:organizations(id, name, logo_url, primary_color, phone))";

  let raw: unknown = null;
  const first = await admin.from("job_quotes").select(fullSelect).eq("id", id).maybeSingle();
  if (first.error) {
    console.warn("[quote] job full select failed, retrying", first.error.message);
    const second = await admin.from("job_quotes").select(v1Select).eq("id", id).maybeSingle();
    raw = second.data;
  } else {
    raw = first.data;
  }
  type RawRow = {
    id: string;
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
    job: { customer: Customer | null; vehicle: Vehicle | null } | null;
    location: { name: string; organization: Org | null } | null;
  };
  const r = raw as RawRow | null;
  if (!r) return null;

  const { data: itemRows } = await admin
    .from("job_quote_items")
    .select("id, description, type, quantity, unit_price")
    .eq("quote_id", id)
    .order("sort_order");

  return {
    id: r.id,
    source: "job",
    status: r.status,
    title: r.title,
    description: r.description,
    customer_message: null,
    video_path: r.video_path,
    subtotal: r.subtotal,
    vat_rate: r.vat_rate,
    vat_amount: r.vat_amount,
    total: r.total,
    expires_at: r.expires_at,
    customer: r.job?.customer ?? null,
    vehicle: r.job?.vehicle ?? null,
    org: r.location?.organization ?? null,
    location_name: r.location?.name ?? null,
    items: (itemRows ?? []) as NormalisedQuote["items"],
  };
}

async function loadStandalone(admin: ReturnType<typeof createAdminClient>, id: string): Promise<NormalisedQuote | null> {
  const { data, error } = await admin
    .from("standalone_quotes")
    .select(
      "id, location_id, status, title, description, customer_message, video_path, subtotal, vat_rate, vat_amount, total, expires_at, customer:customers(full_name), vehicle:vehicles(registration, make, model, year), location:locations(name, organization:organizations(id, name, logo_url, primary_color, phone, quote_deposit_pct))",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("[quote] standalone select failed", error.message);
    return null;
  }
  type RawRow = {
    id: string;
    location_id: string;
    status: string;
    title: string | null;
    description: string | null;
    customer_message: string | null;
    video_path: string | null;
    subtotal: number;
    vat_rate: number;
    vat_amount: number;
    total: number;
    expires_at: string;
    customer: Customer | null;
    vehicle: Vehicle | null;
    location: { name: string; organization: Org | null } | null;
  };
  const r = data as RawRow | null;
  if (!r) return null;

  const { data: itemRows } = await admin
    .from("standalone_quote_items")
    .select("id, description, type, quantity, unit_price")
    .eq("quote_id", id)
    .order("sort_order");

  return {
    id: r.id,
    source: "standalone",
    status: r.status,
    title: r.title,
    description: r.description,
    customer_message: r.customer_message,
    video_path: r.video_path,
    subtotal: r.subtotal,
    vat_rate: r.vat_rate,
    vat_amount: r.vat_amount,
    total: r.total,
    expires_at: r.expires_at,
    customer: r.customer,
    vehicle: r.vehicle,
    org: r.location?.organization ?? null,
    location_name: r.location?.name ?? null,
    items: (itemRows ?? []) as NormalisedQuote["items"],
  };
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
