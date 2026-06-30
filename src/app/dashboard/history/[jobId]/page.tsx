import Link from "next/link";
import { notFound } from "next/navigation";
import { Wrench, Video, Gauge } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortalContext, requireOwnedJob } from "@/lib/portal-auth";
import { createSignedReadUrl } from "@/lib/quote-storage";
import { PortalShell } from "../../portal-shell";

type LineItem = { id: string; description: string; type: string; quantity: number; unit_price: number };
type QuoteItem = LineItem & { quote_id: string; sort_order: number };

type Quote = {
  id: string;
  title: string | null;
  description: string | null;
  video_path: string | null;
  status: string;
  subtotal: number;
  vat_amount: number;
  total: number;
  created_at: string;
};

type TyreCheck = {
  checked_at: string;
  nsf_depth: number | null;
  osf_depth: number | null;
  nsr_depth: number | null;
  osr_depth: number | null;
  nsf_replaced: boolean | null;
  osf_replaced: boolean | null;
  nsr_replaced: boolean | null;
  osr_replaced: boolean | null;
  notes: string | null;
};

function fmt(n: number) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
}

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

const quoteStatusStyle: Record<string, string> = {
  approved: "bg-green-500/20 text-green-400",
  declined: "bg-red-500/20 text-red-400",
  expired: "bg-gray-500/20 text-gray-400",
};

export default async function ServiceHistoryDetailPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;

  const { location, customer } = await getPortalContext();
  if (!customer) notFound();

  const job = await requireOwnedJob(customer.id, jobId);
  const org = location.organization;
  const admin = createAdminClient();

  const [vehicleRes, itemsRes, quotesRes, tyreRes] = await Promise.all([
    job.vehicle_id
      ? admin.from("vehicles").select("registration, make, model, year").eq("id", job.vehicle_id).maybeSingle()
      : Promise.resolve({ data: null }),
    admin.from("job_items").select("id, description, type, quantity, unit_price").eq("job_id", job.id).order("created_at", { ascending: true }),
    admin
      .from("quotes")
      .select("id, title, description, video_path, status, subtotal, vat_amount, total, created_at")
      .eq("job_id", job.id)
      .order("created_at", { ascending: true }),
    job.vehicle_id
      ? admin
          .from("tyre_checks")
          .select("checked_at, nsf_depth, osf_depth, nsr_depth, osr_depth, nsf_replaced, osf_replaced, nsr_replaced, osr_replaced, notes")
          .eq("vehicle_id", job.vehicle_id)
          .order("checked_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const vehicle = vehicleRes.data as { registration: string; make: string | null; model: string | null; year: number | null } | null;
  const items = (itemsRes.data ?? []) as LineItem[];
  const quotes = (quotesRes.data ?? []) as Quote[];
  const tyre = tyreRes.data as TyreCheck | null;

  // Quote line items for all of this job's quotes, grouped by quote.
  const quoteIds = quotes.map((q) => q.id);
  const { data: qItemsData } = quoteIds.length
    ? await admin
        .from("quote_items")
        .select("id, quote_id, description, type, quantity, unit_price, sort_order")
        .in("quote_id", quoteIds)
        .order("sort_order", { ascending: true })
    : { data: [] };
  const quoteItems = (qItemsData ?? []) as QuoteItem[];
  const itemsByQuote = new Map<string, QuoteItem[]>();
  for (const qi of quoteItems) {
    if (!itemsByQuote.has(qi.quote_id)) itemsByQuote.set(qi.quote_id, []);
    itemsByQuote.get(qi.quote_id)!.push(qi);
  }

  // Short-TTL signed read URLs for any inspection videos.
  const videoUrls = new Map<string, string | null>();
  await Promise.all(
    quotes
      .filter((q) => q.video_path)
      .map(async (q) => {
        videoUrls.set(q.id, await createSignedReadUrl(q.video_path!, 1800));
      }),
  );

  const itemsTotal = items.reduce((sum, it) => sum + it.quantity * it.unit_price, 0);
  const vehicleName = vehicle ? [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") : "";

  return (
    <PortalShell org={org}>
      <div>
        <Link href="/dashboard/history" className="text-sm text-gray-400 transition-colors hover:text-white">
          ← Back to service history
        </Link>
      </div>

      <div>
        <p className="mb-1 text-xs uppercase tracking-wider text-gray-500">Service record</p>
        <h1 className="text-2xl font-bold">{job.description || "Service"}</h1>
        <p className="mt-1 text-sm text-gray-400">
          {fmtDate(job.completed_at ?? job.created_at)}
          {vehicle && (
            <>
              {" · "}
              <span className="font-mono tracking-widest text-gray-300">{vehicle.registration}</span>
              {vehicleName && ` · ${vehicleName}`}
            </>
          )}
        </p>
      </div>

      {/* Work carried out */}
      <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm">
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
          <Wrench className="h-4 w-4" /> Work carried out
        </div>
        <table className="w-full text-sm">
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td className="px-4 py-4 text-center text-sm text-gray-500">No line items recorded.</td>
              </tr>
            ) : (
              items.map((it) => (
                <tr key={it.id} className="border-t border-white/5">
                  <td className="px-4 py-3">{it.description}</td>
                  <td className="px-4 py-3 capitalize text-gray-400">{it.type}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-400">×{it.quantity}</td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">{fmt(it.quantity * it.unit_price)}</td>
                </tr>
              ))
            )}
          </tbody>
          {items.length > 0 && (
            <tfoot className="border-t-2 border-white/10">
              <tr>
                <td colSpan={3} className="px-4 py-3 text-right font-semibold">Total</td>
                <td className="px-4 py-3 text-right font-bold tabular-nums">{fmt(itemsTotal)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </section>

      {/* Digital Vehicle Inspections */}
      {quotes.map((q) => {
        const url = videoUrls.get(q.id) ?? null;
        const qItems = itemsByQuote.get(q.id) ?? [];
        return (
          <section key={q.id} className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm">
            <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
              <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                <Video className="h-4 w-4" /> {q.title || "Vehicle inspection"}
              </span>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${quoteStatusStyle[q.status] ?? "bg-blue-500/20 text-blue-400"}`}>
                {q.status}
              </span>
            </div>
            <div className="flex flex-col gap-4 p-4">
              {q.description && <p className="text-sm text-gray-300">{q.description}</p>}
              {q.video_path &&
                (url ? (
                  <video controls preload="metadata" playsInline src={url} className="w-full rounded-lg border border-white/10 bg-black" />
                ) : (
                  <p className="rounded-lg border border-white/10 bg-white/5 p-3 text-xs text-gray-500">Inspection video is no longer available.</p>
                ))}
              {qItems.length > 0 && (
                <table className="w-full text-sm">
                  <tbody>
                    {qItems.map((it) => (
                      <tr key={it.id} className="border-t border-white/5 first:border-t-0">
                        <td className="py-2">{it.description}</td>
                        <td className="py-2 text-right tabular-nums text-gray-400">×{it.quantity}</td>
                        <td className="py-2 text-right font-medium tabular-nums">{fmt(it.quantity * it.unit_price)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t border-white/10">
                    <tr>
                      <td colSpan={2} className="py-2 text-right text-gray-400">Total</td>
                      <td className="py-2 text-right font-semibold tabular-nums">{fmt(q.total)}</td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </section>
        );
      })}

      {/* Latest tyre check */}
      {tyre && (
        <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm">
          <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
            <Gauge className="h-4 w-4" /> Tyre tread — {fmtDate(tyre.checked_at)}
          </div>
          <div className="grid grid-cols-2 gap-3 p-4 text-sm sm:grid-cols-4">
            {[
              { label: "Front NS", depth: tyre.nsf_depth, replaced: tyre.nsf_replaced },
              { label: "Front OS", depth: tyre.osf_depth, replaced: tyre.osf_replaced },
              { label: "Rear NS", depth: tyre.nsr_depth, replaced: tyre.nsr_replaced },
              { label: "Rear OS", depth: tyre.osr_depth, replaced: tyre.osr_replaced },
            ].map((t) => {
              const low = t.depth !== null && t.depth < 3;
              return (
                <div key={t.label} className="rounded-xl bg-white/5 p-3">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-500">{t.label}</p>
                  <p className={`font-semibold ${low ? "text-red-400" : ""}`}>{t.depth !== null ? `${t.depth} mm` : "—"}</p>
                  {t.replaced && <p className="mt-1 text-xs text-green-400">Replaced</p>}
                </div>
              );
            })}
          </div>
          {tyre.notes && <p className="px-4 pb-4 text-sm text-gray-400">{tyre.notes}</p>}
        </section>
      )}
    </PortalShell>
  );
}
