import { History } from "lucide-react";

// Imported / manual service history (#505 PR 2) — work that predates this
// platform. Read-only; deliberately separate from jobs.

export type HistoryEntryRow = {
  id: string;
  vehicle_id: string;
  happened_on: string;
  mileage: number | null;
  description: string;
  total: number | null;
  source: string;
};

const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const fmtGBP = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);

export function ServiceHistorySection({
  entries,
  regByVehicleId,
}: {
  entries: HistoryEntryRow[];
  regByVehicleId: Map<string, string>;
}) {
  if (entries.length === 0) return null;
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <History className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Service history</h2>
        <span className="rounded border border-border px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
          imported history
        </span>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-4 py-2 font-medium">Date</th>
              <th className="px-4 py-2 font-medium">Vehicle</th>
              <th className="px-4 py-2 font-medium">Work</th>
              <th className="px-4 py-2 font-medium text-right">Mileage</th>
              <th className="px-4 py-2 font-medium text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-t align-top">
                <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">{fmtDate(e.happened_on)}</td>
                <td className="px-4 py-2 font-mono">{regByVehicleId.get(e.vehicle_id) ?? "—"}</td>
                <td className="px-4 py-2">{e.description}</td>
                <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                  {e.mileage !== null ? e.mileage.toLocaleString("en-GB") : "—"}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{e.total !== null ? fmtGBP(e.total) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Brought over from your previous system — shown for the vehicle&apos;s record, kept out of jobs, revenue and reports.
      </p>
    </section>
  );
}
