import { notFound } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortalContext, requireOwnedInvoice } from "@/lib/portal-auth";
import { AnimatedBackground } from "@/components/animated-background";
import { CustomerSignOutButton } from "../../dashboard/sign-out-button";

type JobItem = { id: string; description: string; type: string; quantity: number; unit_price: number };

function fmt(n: number) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

export default async function CustomerInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { location, customer } = await getPortalContext();
  if (!customer) notFound();

  const invoice = await requireOwnedInvoice(customer.id, location.id, id);

  const admin = createAdminClient();
  const itemsRes = invoice.job_id
    ? await admin.from("job_items").select("id, description, type, quantity, unit_price").eq("job_id", invoice.job_id).order("created_at", { ascending: true })
    : { data: [] };
  const items = (itemsRes.data ?? []) as JobItem[];

  const org = location.organization;
  const overdue = invoice.status !== "paid" && new Date(invoice.due_at) < new Date();
  const computedStatus = overdue ? "overdue" : invoice.status;

  const statusStyle: Record<string, string> = {
    draft: "bg-gray-500/20 text-gray-400",
    sent: "bg-blue-500/20 text-blue-400",
    paid: "bg-green-500/20 text-green-400",
    overdue: "bg-red-500/20 text-red-400",
  };

  return (
    <div className="relative min-h-screen bg-[#050c1a] text-white overflow-x-hidden">
      <AnimatedBackground brandColor={org.primary_color} />

      <header className="relative z-10 border-b border-white/5 px-6 py-4 backdrop-blur-sm">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <div className="flex items-center gap-3">
            {org.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={org.logo_url} alt={org.name} className="h-8 w-auto object-contain" />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold text-white" style={{ backgroundColor: org.primary_color }}>
                {org.name.split(/\s+/).map((w) => w[0]).join("").toUpperCase().slice(0, 2)}
              </div>
            )}
            <span className="text-sm font-semibold">{org.name}</span>
          </div>
          <CustomerSignOutButton />
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-2xl px-6 py-10 flex flex-col gap-6">
        <div>
          <Link href="/dashboard" className="text-sm text-gray-400 hover:text-white transition-colors">
            ← Back to dashboard
          </Link>
        </div>

        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Invoice</p>
            <h1 className="text-2xl font-bold font-mono">{invoice.invoice_number}</h1>
            <p className="text-sm text-gray-400 mt-1">{org.name}</p>
          </div>
          <span className={`shrink-0 mt-1 rounded-full px-3 py-1 text-xs font-medium capitalize ${statusStyle[computedStatus] ?? ""}`}>
            {computedStatus}
          </span>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 grid grid-cols-3 gap-4 text-sm backdrop-blur-sm">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Bill to</p>
            <p className="font-semibold">{customer.full_name ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Issued</p>
            <p>{fmtDate(invoice.issued_at)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Due</p>
            <p className={computedStatus === "overdue" ? "font-semibold text-red-400" : ""}>{fmtDate(invoice.due_at)}</p>
            {invoice.paid_at && <p className="text-xs text-green-400 mt-1">Paid {fmtDate(invoice.paid_at)}</p>}
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden backdrop-blur-sm">
          <table className="w-full text-sm">
            <thead className="border-b border-white/10">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Description</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Type</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">Qty</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">Total</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-4 text-center text-gray-500 text-sm">No line items</td></tr>
              ) : items.map((it) => (
                <tr key={it.id} className="border-t border-white/5">
                  <td className="px-4 py-3">{it.description}</td>
                  <td className="px-4 py-3 capitalize text-gray-400">{it.type}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{it.quantity}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium">{fmt(it.quantity * it.unit_price)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-white/10">
              <tr>
                <td colSpan={3} className="px-4 py-2 text-right text-gray-400">Subtotal</td>
                <td className="px-4 py-2 text-right tabular-nums">{fmt(invoice.subtotal)}</td>
              </tr>
              <tr>
                <td colSpan={3} className="px-4 py-2 text-right text-gray-400">VAT ({invoice.vat_rate}%)</td>
                <td className="px-4 py-2 text-right tabular-nums">{fmt(invoice.vat_amount)}</td>
              </tr>
              <tr>
                <td colSpan={3} className="px-4 py-3 text-right font-bold text-base">Total</td>
                <td className="px-4 py-3 text-right tabular-nums font-bold text-base">{fmt(invoice.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {invoice.notes && (
          <p className="text-sm text-gray-400">{invoice.notes}</p>
        )}

        <div className="flex gap-3">
          {/* Opens the clean A4 invoice (src/app/invoice/[id]/print) in a new
              tab, which auto-triggers the print dialog → Save as PDF. */}
          <a
            href={`/invoice/${invoice.id}/print`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-gray-300 hover:bg-white/10 transition-colors"
          >
            Print / Save PDF
          </a>
        </div>
      </main>
    </div>
  );
}
