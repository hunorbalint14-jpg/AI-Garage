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
    <section className="rounded-lg border p-4">
      <div className="mb-3 flex items-center gap-2">
        <FileClock className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Past invoices</h2>
        <span className="rounded border border-border px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
          imported history
        </span>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[520px] text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Number</th>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Details</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <tr key={inv.id} className="border-t">
                <td className="px-3 py-2 font-mono">{inv.invoice_number}</td>
                <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{fmtDate(inv.issued_on)}</td>
                <td className="px-3 py-2">{inv.description ?? "—"}</td>
                <td className="px-3 py-2 text-muted-foreground capitalize">{inv.status ?? "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtGBP(inv.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        From your previous system — for the record only. Not part of revenue, VAT or reminders here.
      </p>
    </section>
  );
}
