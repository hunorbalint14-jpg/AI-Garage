import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSignedReadUrl } from "@/lib/quote-storage";
import { JobQuoteDetailActions } from "./job-quote-detail-actions";

export const dynamic = "force-dynamic";

type QuoteRow = {
  id: string;
  job_id: string;
  location_id: string;
  status: string;
  title: string | null;
  description: string | null;
  video_path: string | null;
  subtotal: number;
  vat_rate: number;
  vat_amount: number;
  total: number;
  expires_at: string | null;
  sent_at: string | null;
  last_reminded_at: string | null;
  viewed_at: string | null;
  viewed_count: number;
  responded_at: string | null;
  decline_reason: string | null;
  approved_item_ids: string[];
  created_at: string;
  job: {
    id: string;
    customer: { id: string; full_name: string | null; email: string | null; phone: string | null } | null;
    vehicle: { id: string; registration: string | null; make: string | null; model: string | null } | null;
  } | null;
};

type QuoteItem = {
  id: string;
  description: string;
  type: string;
  quantity: number;
  unit_price: number;
};

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-green-100 text-green-700",
  declined: "bg-red-100 text-red-700",
  rebooked: "bg-blue-100 text-blue-700",
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

export default async function JobQuoteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  const { data: quoteData } = await admin
    .from("job_quotes")
    .select(
      "id, job_id, location_id, status, title, description, video_path, subtotal, vat_rate, vat_amount, total, expires_at, sent_at, last_reminded_at, viewed_at, viewed_count, responded_at, decline_reason, approved_item_ids, created_at, job:jobs(id, customer:customers(id, full_name, email, phone), vehicle:vehicles(id, registration, make, model))",
    )
    .eq("id", id)
    .maybeSingle();

  const quote = quoteData as QuoteRow | null;
  if (!quote || quote.location_id !== ctx.location.id) notFound();

  const { data: itemRows } = await admin
    .from("job_quote_items")
    .select("id, description, type, quantity, unit_price")
    .eq("quote_id", id)
    .order("sort_order");
  const items = (itemRows ?? []) as QuoteItem[];

  const videoUrl = quote.video_path ? await createSignedReadUrl(quote.video_path, 1800) : null;

  const approvedSet = new Set(quote.approved_item_ids ?? []);
  const partial = quote.status === "approved" && (quote.approved_item_ids?.length ?? 0) > 0 && quote.approved_item_ids.length < items.length;

  const customer = quote.job?.customer ?? null;
  const vehicle = quote.job?.vehicle ?? null;

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      <div>
        <Link href={`/staff/jobs/${quote.job_id}`} className="text-sm text-muted-foreground underline">← Back to job</Link>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{quote.title || "(no title)"}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Created {fmtDateTime(quote.created_at)}
          </p>
        </div>
        <span className={`shrink-0 mt-1 inline-block rounded-full px-3 py-1 text-xs font-medium uppercase tracking-wide ${STATUS_STYLE[quote.status] ?? ""}`}>
          {quote.status.replace(/_/g, " ")}
        </span>
      </div>

      <section className="rounded-lg border p-4">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">Customer & vehicle</h2>
        <dl className="grid grid-cols-[140px_1fr] gap-y-1 text-sm">
          <dt className="text-muted-foreground">Customer</dt>
          <dd>
            {customer ? (
              <Link href={`/staff/customers/${customer.id}`} className="underline">
                {customer.full_name ?? "(no name)"}
              </Link>
            ) : "—"}
            {customer && (
              <div className="text-xs text-muted-foreground">
                {customer.email ?? "no email"} · {customer.phone ?? "no phone"}
              </div>
            )}
          </dd>
          <dt className="text-muted-foreground">Vehicle</dt>
          <dd>
            {vehicle ? (
              <>
                <span className="font-mono">{vehicle.registration}</span>
                {(vehicle.make || vehicle.model) && (
                  <span className="text-muted-foreground"> — {[vehicle.make, vehicle.model].filter(Boolean).join(" ")}</span>
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

      {videoUrl && (
        <video controls preload="metadata" playsInline src={videoUrl} className="w-full rounded-lg border bg-black" />
      )}

      <section className="rounded-lg border overflow-hidden">
        <div className="px-4 py-2 bg-muted/40 text-xs font-medium uppercase tracking-wide text-muted-foreground">Items</div>
        <table className="w-full text-sm">
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
        <dl className="grid grid-cols-[160px_1fr] gap-y-1 text-sm">
          <dt className="text-muted-foreground">Sent</dt>
          <dd>{fmtDateTime(quote.sent_at)}</dd>
          <dt className="text-muted-foreground">Last reminded</dt>
          <dd>{fmtDateTime(quote.last_reminded_at)}</dd>
          <dt className="text-muted-foreground">First viewed</dt>
          <dd>{fmtDateTime(quote.viewed_at)} {quote.viewed_count > 0 && <span className="text-muted-foreground">({quote.viewed_count} view{quote.viewed_count === 1 ? "" : "s"})</span>}</dd>
          <dt className="text-muted-foreground">Responded</dt>
          <dd>{fmtDateTime(quote.responded_at)}</dd>
          <dt className="text-muted-foreground">Expires</dt>
          <dd>{fmtDateTime(quote.expires_at)}</dd>
          {quote.decline_reason && (
            <>
              <dt className="text-muted-foreground">Decline reason</dt>
              <dd className="whitespace-pre-wrap">{quote.decline_reason}</dd>
            </>
          )}
        </dl>
      </section>

      <JobQuoteDetailActions quoteId={quote.id} status={quote.status} />
    </div>
  );
}
