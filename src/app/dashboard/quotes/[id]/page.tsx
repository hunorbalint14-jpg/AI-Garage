import Link from "next/link";
import { notFound } from "next/navigation";
import { Video, CheckCircle } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortalContext, requireOwnedQuote } from "@/lib/portal-auth";
import { createSignedReadUrl } from "@/lib/quote-storage";
import { PortalShell } from "../../portal-shell";
import { QuoteResponseOwner } from "./quote-response-owner";

type QuoteDetail = {
  id: string;
  title: string | null;
  description: string | null;
  video_path: string | null;
  status: string;
  subtotal: number;
  vat_amount: number;
  total: number;
  deposit_required: boolean | null;
  deposit_pct: number | null;
  deposit_amount: number | null;
};
type Item = { id: string; description: string; type: string; quantity: number; unit_price: number; sort_order: number };

function fmt(n: number) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
}

const STATUS_BANNER: Record<string, { label: string; style: string }> = {
  approved: { label: "You approved this quote.", style: "border-green-500/30 bg-green-500/10 text-green-400" },
  approved_after_close: { label: "You approved this quote.", style: "border-green-500/30 bg-green-500/10 text-green-400" },
  declined: { label: "You declined this quote.", style: "border-red-500/30 bg-red-500/10 text-red-400" },
  rebooked: { label: "This quote was moved to a new booking.", style: "border-blue-500/30 bg-blue-500/10 text-blue-400" },
  expired: { label: "This quote has expired. Contact the garage to renew it.", style: "border-gray-500/30 bg-gray-500/10 text-gray-400" },
};

export default async function PortalQuoteDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ deposit?: string }>;
}) {
  const { id } = await params;
  const { deposit } = await searchParams;

  const { location, customer } = await getPortalContext();
  if (!customer) notFound();

  const quote = await requireOwnedQuote(customer.id, id);
  const org = location.organization;
  const admin = createAdminClient();

  const quotesTable = "quotes";
  const itemsTable = quote.source === "job" ? "quote_items" : "quote_items";

  const [detailRes, itemsRes] = await Promise.all([
    admin
      .from(quotesTable)
      .select("id, title, description, video_path, status, subtotal, vat_amount, total, deposit_required, deposit_pct, deposit_amount")
      .eq("id", quote.id)
      .maybeSingle(),
    admin.from(itemsTable).select("id, description, type, quantity, unit_price, sort_order").eq("quote_id", quote.id).order("sort_order", { ascending: true }),
  ]);

  const detail = detailRes.data as QuoteDetail | null;
  if (!detail) notFound();
  const items = (itemsRes.data ?? []) as Item[];

  const videoUrl = detail.video_path ? await createSignedReadUrl(detail.video_path, 1800) : null;
  const isPending = detail.status === "pending";
  const justPaid = deposit === "success";
  const banner = STATUS_BANNER[detail.status];

  return (
    <PortalShell org={org}>
      <div>
        <Link href="/dashboard/quotes" className="text-sm text-gray-400 transition-colors hover:text-white">
          ← Back to quotes
        </Link>
      </div>

      <div>
        <p className="mb-1 text-xs uppercase tracking-wider text-gray-500">Quote</p>
        <h1 className="text-2xl font-bold">{detail.title || "Quote"}</h1>
      </div>

      {justPaid && (
        <p className="flex items-center gap-2 rounded-xl border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-400">
          <CheckCircle className="h-4 w-4" /> Deposit received — thank you. The garage has been notified.
        </p>
      )}
      {!justPaid && banner && <p className={`rounded-xl border p-3 text-sm ${banner.style}`}>{banner.label}</p>}

      {detail.description && <p className="text-sm text-gray-300">{detail.description}</p>}

      {detail.video_path &&
        (videoUrl ? (
          <video controls preload="metadata" playsInline src={videoUrl} className="w-full rounded-lg border border-white/10 bg-black" />
        ) : (
          <p className="rounded-lg border border-white/10 bg-white/5 p-3 text-xs text-gray-500">
            <Video className="mr-1 inline h-3 w-3" /> Inspection video is no longer available.
          </p>
        ))}

      <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm">
        <table className="w-full text-sm">
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td className="px-4 py-4 text-center text-gray-500">No items.</td>
              </tr>
            ) : (
              items.map((it) => (
                <tr key={it.id} className="border-t border-white/5 first:border-t-0">
                  <td className="px-4 py-3">{it.description}</td>
                  <td className="px-4 py-3 capitalize text-gray-400">{it.type}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-400">×{it.quantity}</td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">{fmt(it.quantity * it.unit_price)}</td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot className="border-t-2 border-white/10">
            <tr>
              <td colSpan={3} className="px-4 py-2 text-right text-gray-400">Subtotal</td>
              <td className="px-4 py-2 text-right tabular-nums">{fmt(detail.subtotal)}</td>
            </tr>
            <tr>
              <td colSpan={3} className="px-4 py-2 text-right text-gray-400">VAT</td>
              <td className="px-4 py-2 text-right tabular-nums">{fmt(detail.vat_amount)}</td>
            </tr>
            <tr>
              <td colSpan={3} className="px-4 py-3 text-right text-base font-bold">Total</td>
              <td className="px-4 py-3 text-right text-base font-bold tabular-nums">{fmt(detail.total)}</td>
            </tr>
          </tfoot>
        </table>
      </section>

      {isPending && detail.deposit_required && detail.deposit_amount != null && (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-300">
          Approving requires a {detail.deposit_pct}% deposit of {fmt(detail.deposit_amount)} to secure the work. You&apos;ll be taken to a secure payment page.
        </p>
      )}

      {isPending && <QuoteResponseOwner quoteId={quote.id} orgColor={org.primary_color} />}
    </PortalShell>
  );
}
