import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSignedReadUrl } from "@/lib/quote-storage";
import { listLocationStaff } from "@/lib/staff-directory";
import { QuoteDetailActions } from "./quote-detail-actions";
import { WorkshopBadge, type WorkshopTone } from "@/components/staff/workshop";

export const dynamic = "force-dynamic";

type PersonRef = { id: string; full_name: string | null; email: string | null; phone: string | null } | null;
type VehicleRef = { id: string; registration: string | null; make: string | null; model: string | null } | null;

type QuoteRow = {
  id: string;
  quote_type: "job" | "standalone";
  job_id: string | null;
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
  revision_number: number;
  revision_note: string | null;
  reminder_count: number;
  last_reminder_at: string | null;
  sent_channels: string[] | null;
  link_token_encrypted: string | null;
  converted_booking_id: string | null;
  customer: PersonRef;
  vehicle: VehicleRef;
  job: { id: string; customer: PersonRef; vehicle: VehicleRef } | null;
};

type RevisionRow = {
  id: string;
  revision_number: number;
  note: string;
  created_by: string | null;
  created_at: string;
};

type QuoteItem = {
  id: string;
  description: string;
  type: string;
  quantity: number;
  unit_price: number;
};

const STATUS_TONE: Record<string, WorkshopTone> = {
  draft: "neutral",
  pending: "amber",
  approved: "green",
  declined: "red",
  expired: "neutral",
  cancelled: "neutral",
  approved_after_close: "purple",
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
    .from("quotes")
    .select(
      "id, quote_type, job_id, location_id, status, title, description, customer_message, video_path, subtotal, vat_rate, vat_amount, total, expires_at, sent_at, viewed_at, viewed_count, responded_at, decline_reason, approved_item_ids, deposit_required, deposit_pct, deposit_amount, deposit_paid_at, created_at, revision_number, revision_note, reminder_count, last_reminder_at, sent_channels, link_token_encrypted, converted_booking_id, customer:customers(id, full_name, email, phone), vehicle:vehicles(id, registration, make, model), job:jobs(id, customer:customers(id, full_name, email, phone), vehicle:vehicles(id, registration, make, model))",
    )
    .eq("id", id)
    .maybeSingle();

  const quote = quoteData as QuoteRow | null;
  if (!quote || quote.location_id !== ctx.location.id) notFound();

  const { data: itemRows } = await admin
    .from("quote_items")
    .select("id, description, type, quantity, unit_price")
    .eq("quote_id", id)
    .order("sort_order");
  const items = (itemRows ?? []) as QuoteItem[];

  const videoUrl = quote.video_path ? await createSignedReadUrl(quote.video_path, 1800) : null;

  // Revision history (Phase 5) — one row per re-send, newest last. Staff names
  // resolved through the cached location roster.
  const { data: revisionRows } = await admin
    .from("quote_revisions")
    .select("id, revision_number, note, created_by, created_at")
    .eq("quote_id", id)
    .order("revision_number");
  const revisions = (revisionRows ?? []) as RevisionRow[];
  const staffNameById = new Map<string, string>();
  if (revisions.length > 0) {
    const roster = await listLocationStaff(ctx.location.id, ctx.organization.id);
    for (const s of roster) staffNameById.set(s.id, s.name);
  }

  const approvedSet = new Set(quote.approved_item_ids ?? []);
  const partial = quote.status === "approved" && (quote.approved_item_ids?.length ?? 0) > 0 && quote.approved_item_ids.length < items.length;

  // A DVI (job) quote's customer + vehicle come from its parent job; standalone
  // quotes carry them directly.
  const isJob = quote.quote_type === "job";
  const displayCustomer = isJob ? quote.job?.customer ?? null : quote.customer;
  const displayVehicle = isJob ? quote.job?.vehicle ?? null : quote.vehicle;

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <Link href="/staff/quotes" className="text-muted-foreground underline">← Back to quotes</Link>
        {isJob && quote.job_id && (
          <Link href={`/staff/jobs/${quote.job_id}`} className="text-muted-foreground underline">
            ← Back to job
          </Link>
        )}
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{quote.title || "(no title)"}</h1>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                isJob ? "bg-ws-purple-bg text-ws-purple" : "bg-ws-blue-bg text-ws-blue"
              }`}
            >
              {isJob ? "DVI" : "Pre-job"}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Created {fmtDateTime(quote.created_at)}
            {quote.revision_number > 1 && (
              <span className="ml-2 rounded-full bg-ws-amber-bg px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ws-amber">
                Revision {quote.revision_number}
              </span>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <a
            href={`/api/quote/${quote.id}/print`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-flex items-center rounded-md border px-3 py-1 text-xs font-medium hover:bg-muted/40"
          >
            Download PDF
          </a>
          <WorkshopBadge tone={STATUS_TONE[quote.status] ?? "neutral"} className="mt-1">
            {quote.status.replace(/_/g, " ")}
          </WorkshopBadge>
        </div>
      </div>

      <section className="rounded-lg border p-4">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">Customer & vehicle</h2>
        <dl className="grid grid-cols-[140px_1fr] gap-y-1 text-sm">
          <dt className="text-muted-foreground">Customer</dt>
          <dd>
            {displayCustomer ? (
              <Link href={`/staff/customers/${displayCustomer.id}`} className="underline">
                {displayCustomer.full_name ?? "(no name)"}
              </Link>
            ) : "—"}
            {displayCustomer && (
              <div className="text-xs text-muted-foreground">
                {displayCustomer.email ?? "no email"} · {displayCustomer.phone ?? "no phone"}
              </div>
            )}
          </dd>
          <dt className="text-muted-foreground">Vehicle</dt>
          <dd>
            {displayVehicle ? (
              <>
                <span className="font-mono">{displayVehicle.registration}</span>
                {(displayVehicle.make || displayVehicle.model) && (
                  <span className="text-muted-foreground"> — {[displayVehicle.make, displayVehicle.model].filter(Boolean).join(" ")}</span>
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
          <dt className="text-muted-foreground">First viewed</dt>
          <dd>{fmtDateTime(quote.viewed_at)} {quote.viewed_count > 0 && <span className="text-muted-foreground">({quote.viewed_count} view{quote.viewed_count === 1 ? "" : "s"})</span>}</dd>
          <dt className="text-muted-foreground">Responded</dt>
          <dd>{fmtDateTime(quote.responded_at)}</dd>
          <dt className="text-muted-foreground">Expires</dt>
          <dd>{fmtDateTime(quote.expires_at)}</dd>
          {quote.reminder_count > 0 && (
            <>
              <dt className="text-muted-foreground">Reminders</dt>
              <dd>
                {quote.reminder_count} sent
                {quote.last_reminder_at && <span className="text-muted-foreground"> · last {fmtDateTime(quote.last_reminder_at)}</span>}
              </dd>
            </>
          )}
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

      {revisions.length > 0 && (
        <section className="rounded-lg border overflow-hidden">
          <div className="px-4 py-2 bg-muted/40 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Revision history
          </div>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Version</th>
                <th className="px-4 py-2 font-medium">What changed</th>
                <th className="px-4 py-2 font-medium">Revised by</th>
                <th className="px-4 py-2 font-medium">Date</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t">
                <td className="px-4 py-2 tabular-nums">v1</td>
                <td className="px-4 py-2 text-muted-foreground italic">Original</td>
                <td className="px-4 py-2">—</td>
                <td className="px-4 py-2">{fmtDateTime(quote.created_at)}</td>
              </tr>
              {revisions.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-4 py-2 tabular-nums">v{r.revision_number}</td>
                  <td className="px-4 py-2 whitespace-pre-wrap">{r.note}</td>
                  <td className="px-4 py-2">{r.created_by ? staffNameById.get(r.created_by) ?? "Staff" : "—"}</td>
                  <td className="px-4 py-2">{fmtDateTime(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <QuoteDetailActions
        quoteId={quote.id}
        status={quote.status}
        reminder={{
          hasEmail: !!displayCustomer?.email,
          hasPhone: !!displayCustomer?.phone,
          sentChannels: quote.sent_channels ?? [],
          linkAvailable: !!quote.link_token_encrypted,
        }}
        convert={{
          quoteType: quote.quote_type,
          convertedBookingId: quote.converted_booking_id,
          customerName: displayCustomer?.full_name ?? null,
          vehicleReg: displayVehicle?.registration ?? null,
        }}
      />
    </div>
  );
}
