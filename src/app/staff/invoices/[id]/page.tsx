import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { InvoiceActions } from "./invoice-actions";

type Invoice = {
  id: string;
  invoice_number: string;
  status: string;
  subtotal: number;
  vat_rate: number;
  vat_amount: number;
  total: number;
  discount_amount: number;
  discount_description: string | null;
  membership_credit_amount: number;
  membership_credit_description: string | null;
  issued_at: string;
  due_at: string;
  paid_at: string | null;
  notes: string | null;
  location_id: string;
  job_id: string | null;
  stripe_payment_intent_id: string | null;
  stripe_paid_amount_pence: number | null;
  customer: { id: string; full_name: string | null; email: string | null } | null;
};

type CreditNote = { id: string; credit_number: string | null; reason: string | null; total: number; created_at: string };

type JobItem = {
  id: string;
  description: string;
  type: string;
  quantity: number;
  unit_price: number;
};

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600",
  sent: "bg-blue-100 text-blue-700",
  paid: "bg-green-100 text-green-700",
  overdue: "bg-red-100 text-red-700",
  part_refunded: "bg-amber-100 text-amber-700",
  refunded: "bg-purple-100 text-purple-700",
};

function fmt(n: number) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
}

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  const [invoiceRes, orgRes] = await Promise.all([
    admin
      .from("invoices")
      .select("id, invoice_number, status, subtotal, vat_rate, vat_amount, total, discount_amount, discount_description, membership_credit_amount, membership_credit_description, issued_at, due_at, paid_at, notes, location_id, job_id, stripe_payment_intent_id, stripe_paid_amount_pence, customer:customers(id, full_name, email)")
      .eq("id", id)
      .maybeSingle(),
    admin.from("organizations").select("name, phone").eq("id", ctx.organization.id).maybeSingle(),
  ]);

  const invoice = invoiceRes.data as Invoice | null;
  if (!invoice || invoice.location_id !== ctx.location.id) notFound();

  const [itemsRes, creditNotesRes] = await Promise.all([
    invoice.job_id
      ? admin.from("job_items").select("id, description, type, quantity, unit_price").eq("job_id", invoice.job_id).order("created_at", { ascending: true })
      : Promise.resolve({ data: [] }),
    admin.from("credit_notes").select("id, credit_number, reason, total, created_at").eq("invoice_id", invoice.id).order("created_at", { ascending: true }),
  ]);

  const items = (itemsRes.data ?? []) as JobItem[];
  const creditNotes = (creditNotesRes.data ?? []) as CreditNote[];
  const refundedTotal = creditNotes.reduce((s, c) => s + Number(c.total), 0);
  const paidGross = invoice.stripe_paid_amount_pence != null ? invoice.stripe_paid_amount_pence / 100 : Number(invoice.total);
  const refundablePence = invoice.status === "paid" || invoice.status === "part_refunded"
    ? Math.max(0, Math.round((paidGross - refundedTotal) * 100))
    : 0;
  const computedStatus =
    invoice.status === "sent" && new Date(invoice.due_at) < new Date() ? "overdue" : invoice.status;

  const garageName = orgRes.data?.name ?? ctx.organization.name;

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div>
        <Link href="/staff/invoices" className="text-sm text-muted-foreground underline">
          ← Back to invoices
        </Link>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-mono">{invoice.invoice_number}</h1>
          <p className="text-sm text-muted-foreground mt-1">{garageName}</p>
        </div>
        <span className={`shrink-0 mt-1 inline-block rounded-full px-3 py-1 text-xs font-medium capitalize ${STATUS_STYLE[computedStatus] ?? ""}`}>
          {computedStatus.replace(/_/g, " ")}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-4 text-sm">
        <div>
          <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Bill to</p>
          <p className="font-medium">{invoice.customer?.full_name ?? "—"}</p>
          {invoice.customer?.email && <p className="text-muted-foreground">{invoice.customer.email}</p>}
        </div>
        <div>
          <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Issued</p>
          <p>{new Date(invoice.issued_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Due</p>
          <p className={computedStatus === "overdue" ? "font-semibold text-red-600" : ""}>
            {new Date(invoice.due_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
          </p>
        </div>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-4 py-2 font-medium">Description</th>
              <th className="px-4 py-2 font-medium">Type</th>
              <th className="px-4 py-2 font-medium text-right">Qty</th>
              <th className="px-4 py-2 font-medium text-right">Unit</th>
              <th className="px-4 py-2 font-medium text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className="border-t">
                <td className="px-4 py-2">{it.description}</td>
                <td className="px-4 py-2 capitalize text-muted-foreground">{it.type}</td>
                <td className="px-4 py-2 text-right tabular-nums">{it.quantity}</td>
                <td className="px-4 py-2 text-right tabular-nums">{fmt(it.unit_price)}</td>
                <td className="px-4 py-2 text-right tabular-nums font-medium">{fmt(it.quantity * it.unit_price)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 bg-muted/20">
            <tr>
              <td colSpan={4} className="px-4 py-2 text-right text-muted-foreground">Subtotal</td>
              <td className="px-4 py-2 text-right tabular-nums">{fmt(invoice.subtotal)}</td>
            </tr>
            {invoice.membership_credit_amount > 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-2 text-right text-muted-foreground">
                  {invoice.membership_credit_description ?? "Included in membership"}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-green-700">− {fmt(invoice.membership_credit_amount)}</td>
              </tr>
            )}
            {invoice.discount_amount > 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-2 text-right text-muted-foreground">
                  {invoice.discount_description ?? "Member discount"}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-green-700">− {fmt(invoice.discount_amount)}</td>
              </tr>
            )}
            <tr>
              <td colSpan={4} className="px-4 py-2 text-right text-muted-foreground">VAT ({invoice.vat_rate}%)</td>
              <td className="px-4 py-2 text-right tabular-nums">{fmt(invoice.vat_amount)}</td>
            </tr>
            <tr>
              <td colSpan={4} className="px-4 py-2 text-right font-bold text-base">Total</td>
              <td className="px-4 py-2 text-right tabular-nums font-bold text-base">{fmt(invoice.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {invoice.notes && (
        <p className="text-sm text-muted-foreground">{invoice.notes}</p>
      )}

      {invoice.paid_at && (
        <p className="text-sm text-green-700 font-medium">
          Paid {new Date(invoice.paid_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
        </p>
      )}

      {invoice.job_id && (
        <p className="text-sm">
          <Link href={`/staff/jobs/${invoice.job_id}`} className="underline text-muted-foreground">
            ← View job card
          </Link>
        </p>
      )}

      {creditNotes.length > 0 && (
        <div className="rounded-lg border p-4">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">Refunds / credit notes</h2>
          <ul className="flex flex-col gap-1.5 text-sm">
            {creditNotes.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3">
                <span>
                  <span className="font-mono text-xs">{c.credit_number ?? "Credit"}</span>
                  <span className="ml-2 text-muted-foreground">{new Date(c.created_at).toLocaleDateString("en-GB")}{c.reason ? ` · ${c.reason}` : ""}</span>
                </span>
                <span className="tabular-nums text-red-600">− {fmt(Number(c.total))}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 border-t pt-2 text-sm text-muted-foreground">
            Total refunded: <span className="font-semibold tabular-nums text-foreground">{fmt(refundedTotal)}</span>
          </p>
        </div>
      )}

      <InvoiceActions
        invoiceId={invoice.id}
        status={computedStatus}
        hasCustomerEmail={!!invoice.customer?.email}
        refundablePence={refundablePence}
      />
    </div>
  );
}
