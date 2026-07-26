import { FileClock } from "lucide-react";

// Invoices brought over from the previous system (#505 PR 3). Read-only —
// separate table from public.invoices, so numbering/VAT/revenue/dunning/Xero
// never see them.

export type ImportedInvoiceRow = {
  id: string;
  invoice_number: string;
  issued_on: string;
  total: number;
  status: string | null;
  description: string | null;
};

const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const fmtGBP = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);

export function ImportedInvoicesSection({ invoices }: { invoices: ImportedInvoiceRow[] }) {
  if (invoices.length === 0) return null;
  return (
    <section className="rounded-[12px] border border-ws-border bg-ws-card px-5 py-4">
      <div className="mb-3 flex items-center gap-2">
        <FileClock className="h-3.5 w-3.5 text-ws-text-3" />
        <h2 className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ws-text-3">
          {"// PAST INVOICES"}
        </h2>
        <span className="rounded border border-ws-border px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.1em] text-ws-text-3">
          imported
        </span>
      </div>
      <div className="overflow-x-auto rounded-[10px] border border-ws-border">
        <table className="w-full min-w-[520px] text-[13px]">
          <thead className="bg-ws-rail text-left font-mono text-[10px] uppercase tracking-[0.12em] text-ws-text-3">
            <tr>
              <th className="px-3 py-2 font-semibold">Number</th>
              <th className="px-3 py-2 font-semibold">Date</th>
              <th className="px-3 py-2 font-semibold">Details</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 text-right font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <tr key={inv.id} className="border-t border-ws-border">
                <td className="px-3 py-2 font-mono text-ws-text">{inv.invoice_number}</td>
                <td className="whitespace-nowrap px-3 py-2 text-ws-text-2">{fmtDate(inv.issued_on)}</td>
                <td className="px-3 py-2 text-ws-text">{inv.description ?? "—"}</td>
                <td className="px-3 py-2 capitalize text-ws-text-2">{inv.status ?? "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums text-ws-text">{fmtGBP(inv.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11.5px] text-ws-text-3">
        From your previous system — for the record only. Not part of revenue, VAT or reminders here.
      </p>
    </section>
  );
}
