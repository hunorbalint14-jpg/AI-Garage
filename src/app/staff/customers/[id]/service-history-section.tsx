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
    <section className="rounded-[12px] border border-ws-border bg-ws-card px-5 py-4">
      <div className="mb-3 flex items-center gap-2">
        <History className="h-3.5 w-3.5 text-ws-text-3" />
        <h2 className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ws-text-3">
          {"// SERVICE HISTORY"}
        </h2>
        <span className="rounded border border-ws-border px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.1em] text-ws-text-3">
          imported
        </span>
      </div>
      <div className="overflow-x-auto rounded-[10px] border border-ws-border">
        <table className="w-full min-w-[560px] text-[13px]">
          <thead className="bg-ws-rail text-left font-mono text-[10px] uppercase tracking-[0.12em] text-ws-text-3">
            <tr>
              <th className="px-3 py-2 font-semibold">Date</th>
              <th className="px-3 py-2 font-semibold">Vehicle</th>
              <th className="px-3 py-2 font-semibold">Work</th>
              <th className="px-3 py-2 text-right font-semibold">Mileage</th>
              <th className="px-3 py-2 text-right font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-t border-ws-border align-top">
                <td className="whitespace-nowrap px-3 py-2 text-ws-text-2">{fmtDate(e.happened_on)}</td>
                <td className="px-3 py-2 font-mono text-ws-text-2">{regByVehicleId.get(e.vehicle_id) ?? "—"}</td>
                <td className="px-3 py-2 text-ws-text">{e.description}</td>
                <td className="px-3 py-2 text-right tabular-nums text-ws-text-2">
                  {e.mileage !== null ? e.mileage.toLocaleString("en-GB") : "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-ws-text">
                  {e.total !== null ? fmtGBP(e.total) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11.5px] text-ws-text-3">
        Brought over from your previous system — shown for the vehicle&apos;s record, kept out of jobs, revenue and reports.
      </p>
    </section>
  );
}
