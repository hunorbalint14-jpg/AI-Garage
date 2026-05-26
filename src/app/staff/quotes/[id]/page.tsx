import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSignedReadUrl } from "@/lib/quote-storage";
import { QuoteDetailActions } from "./quote-detail-actions";

export const dynamic = "force-dynamic";

type QuoteRow = {
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
  expires_at: string | null;
  sent_at: string | null;
  viewed_at: string | null;
  viewed_count: number;
  responded_at: string | null;
  decline_reason: string | null;
  approved_item_ids: string[];
  deposit_required: boolean;
  deposit_pct: number | null;
  deposit_amount: number | null;
  deposit_paid_at: string | null;
  created_at: string;
  customer: { id: string; full_name: string | null; email: string | null; phone: string | null } | null;
  vehicle: { id: string; registration: string | null; make: string | null; model: string | null } | null;
};

type QuoteItem = {
  id: string;
  description: string;
  type: string;
  quantity: number;
  unit_price: number;
};

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600",
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-green-100 text-green-700",
  declined: "bg-red-100 text-red-700",
  expired: "bg-gray-200 text-gray-700",
  cancelled: "bg-gray-200 text-gray-700",
  approved_after_close: "bg-purple-100 text-purple-700",
};

function fmt(n: number) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
}

function fmtDateTime(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export default async function QuoteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  const { data: quoteData } = await admin
    .from("standalone_quotes")
    .select(
      "id, location_id, status, title, description, customer_message, video_path, subtotal, vat_rate, vat_amount, total, expires_at, sent_at, viewed_at, viewed_count, responded_at, decline_reason, approved_item_ids, deposit_required, deposit_pct, deposit_amount, deposit_paid_at, created_at, customer:customers(id, full_name, email, phone), vehicle:vehicles(id, registration, make, model)",
    )
    .eq("id", id)
    .maybeSingle();

  const quote = quoteData as QuoteRow | null;
  if (!quote || quote.location_id !== ctx.location.id) notFound();

  const { data: itemRows } = await admin
    .from("standalone_quote_items")
    .select("id, description, type, quantity, unit_price")
    .eq("quote_id", id)
    .order("sort_order");
  const items = (itemRows ?? []) as QuoteItem[];

  const videoUrl = quote.video_path ? await createSignedReadUrl(quote.video_path, 1800) : null;

  const approvedSet = new Set(quote.approved_item_ids ?? []);
  const partial = quote.status === "approved" && (quote.approved_item_ids?.length ?? 0) > 0 && quote.approved_item_ids.length < items.length;

  return (
    <div className="flex flex-col gap-4 sm:gap-6 max-w-4xl">
      <div>
        <Link href="/staff/quotes" className="text-sm text-muted-foreground underline">← Back to quotes</Link>
      </div>

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl sm:text-2xl font-bold break-words">{quote.title || "(no title)"}</h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            Created {fmtDateTime(quote.created_at)}
          </p>
        </div>
        <span className={`shrink-0 mt-1 inline-block rounded-full px-2 sm:px-3 py-0.5 sm:py-1 text-[10px] sm:text-xs font-medium uppercase tracking-wide ${STATUS_STYLE[quote.status] ?? ""}`}>
          {quote.status.replace(/_/g, " ")}
        </span>
      </div>

      <section className="rounded-lg border p-4">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">Customer & vehicle</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-x-3 gap-y-2 sm:gap-y-1 text-sm">
          <dt className="text-muted-foreground">Customer</dt>
          <dd>
            {quote.customer ? (
              <Link href={`/staff/customers/${quote.customer.id}`} className="underline">
                {quote.customer.full_name ?? "(no name)"}
              </Link>
            ) : "—"}
            {quote.customer && (
              <div className="text-xs text-muted-foreground">
                {quote.customer.email ?? "no email"} · {quote.customer.phone ?? "no phone"}
              </div>
            )}
          </dd>
          <dt className="text-muted-foreground">Vehicle</dt>
          <dd>
            {quote.vehicle ? (
              <>
                <span className="font-mono">{quote.vehicle.registration}</span>
                {(quote.vehicle.make || quote.vehicle.model) && (
                  <span className="text-muted-foreground"> — {[quote.vehicle.make, quote.vehicle.model].filter(Boolean).join(" ")}</span>
                )}
              </>
            ) : "—"}
          </dd>
        </dl>
      </section>

      {quote.description && (
        <section className="rounded-lg border p-4">
          <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">Staff notes</h2>
          <p className="text-sm whitespace-pre-wrap">{quote.description}</p>
        </section>
      )}

      {quote.customer_message && (
        <section className="rounded-lg border p-4">
          <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">Message to customer</h2>
          <p className="text-sm whitespace-pre-wrap">{quote.customer_message}</p>
        </section>
      )}

      {videoUrl && (
        <video controls preload="metadata" playsInline src={videoUrl} className="w-full rounded-lg border bg-black" />
      )}

      <section className="rounded-lg border overflow-hidden">
        <div className="px-4 py-2 bg-muted/40 text-xs font-medium uppercase tracking-wide text-muted-foreground">Items</div>

        {/* Mobile / tablet — stacked items + totals below. */}
        <div className="md:hidden">
          <ul className="divide-y">
            {items.map((it) => (
              <li key={it.id} className="px-3 py-2 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm break-words">{it.description}</div>
                  <div className="text-xs text-muted-foreground capitalize">
                    {it.type} · {it.quantity} × {fmt(Number(it.unit_price))}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm font-semibold tabular-nums">{fmt(Number(it.quantity) * Number(it.unit_price))}</div>
                  {partial && (
                    <div className="text-xs text-muted-foreground">{approvedSet.has(it.id) ? "Approved" : "—"}</div>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <dl className="border-t bg-muted/30 grid grid-cols-2 gap-y-1 px-3 py-2 text-sm">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd className="text-right tabular-nums">{fmt(Number(quote.subtotal))}</dd>
            <dt className="text-muted-foreground">VAT ({quote.vat_rate}%)</dt>
            <dd className="text-right tabular-nums">{fmt(Number(quote.vat_amount))}</dd>
            <dt className="font-semibold">Total</dt>
            <dd className="text-right tabular-nums font-semibold">{fmt(Number(quote.total))}</dd>
          </dl>
        </div>

        {/* Desktop — full table. */}
        <table className="hidden md:table w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Description</th>
              <th className="px-4 py-2 font-medium">Type</th>
              <th className="px-4 py-2 font-medium text-right">Qty</th>
              <th className="px-4 py-2 font-medium text-right">Unit £</th>
              <th className="px-4 py-2 font-medium text-right">Total</th>
              {partial && <th className="px-4 py-2 font-medium">Approved?</th>}
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className="border-t">
                <td className="px-4 py-2">{it.description}</td>
                <td className="px-4 py-2 capitalize">{it.type}</td>
                <td className="px-4 py-2 text-right tabular-nums">{it.quantity}</td>
                <td className="px-4 py-2 text-right tabular-nums">{fmt(Number(it.unit_price))}</td>
                <td className="px-4 py-2 text-right tabular-nums">{fmt(Number(it.quantity) * Number(it.unit_price))}</td>
                {partial && (
                  <td className="px-4 py-2 text-center">
                    {approvedSet.has(it.id) ? "✓" : "—"}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-muted/30 text-sm">
            <tr className="border-t">
              <td colSpan={4} className="px-4 py-1.5 text-right text-muted-foreground">Subtotal</td>
              <td className="px-4 py-1.5 text-right tabular-nums">{fmt(Number(quote.subtotal))}</td>
              {partial && <td />}
            </tr>
            <tr>
              <td colSpan={4} className="px-4 py-1.5 text-right text-muted-foreground">VAT ({quote.vat_rate}%)</td>
              <td className="px-4 py-1.5 text-right tabular-nums">{fmt(Number(quote.vat_amount))}</td>
              {partial && <td />}
            </tr>
            <tr className="border-t-2 font-semibold">
              <td colSpan={4} className="px-4 py-2 text-right">Total</td>
              <td className="px-4 py-2 text-right tabular-nums">{fmt(Number(quote.total))}</td>
              {partial && <td />}
            </tr>
          </tfoot>
        </table>
      </section>

      <section className="rounded-lg border p-4">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">Timeline</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-x-3 gap-y-2 sm:gap-y-1 text-sm">
          <dt className="text-muted-foreground">Sent</dt>
          <dd>{fmtDateTime(quote.sent_at)}</dd>
          <dt className="text-muted-foreground">First viewed</dt>
          <dd>{fmtDateTime(quote.viewed_at)} {quote.viewed_count > 0 && <span className="text-muted-foreground">({quote.viewed_count} view{quote.viewed_count === 1 ? "" : "s"})</span>}</dd>
          <dt className="text-muted-foreground">Responded</dt>
          <dd>{fmtDateTime(quote.responded_at)}</dd>
          <dt className="text-muted-foreground">Expires</dt>
          <dd>{fmtDateTime(quote.expires_at)}</dd>
          {quote.deposit_required && (
            <>
              <dt className="text-muted-foreground">Deposit ({quote.deposit_pct}%)</dt>
              <dd>{quote.deposit_amount ? fmt(Number(quote.deposit_amount)) : "—"} {quote.deposit_paid_at ? `· paid ${fmtDateTime(quote.deposit_paid_at)}` : "· awaiting payment"}</dd>
            </>
          )}
          {quote.decline_reason && (
            <>
              <dt className="text-muted-foreground">Decline reason</dt>
              <dd className="whitespace-pre-wrap">{quote.decline_reason}</dd>
            </>
          )}
        </dl>
      </section>

      <QuoteDetailActions quoteId={quote.id} status={quote.status} />
    </div>
  );
}
