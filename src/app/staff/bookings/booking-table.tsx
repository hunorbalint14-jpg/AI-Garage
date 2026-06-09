"use client";

import { useRouter } from "next/navigation";
import { STATUS_STYLE, statusLabel, typeLabel, type BookingRow } from "./booking-display";

export type BookingListRow = BookingRow & { technicianName: string | null };

// Clickable booking list. Whole row (desktop) / card (mobile) opens the
// booking — the old table only offered a small "View" link at the far right,
// and forced a 700px horizontal scroll on phones.
export function BookingTable({ rows }: { rows: BookingListRow[] }) {
  const router = useRouter();
  const go = (id: string) => router.push(`/staff/bookings/${id}`);

  const fmtDateTime = (iso: string) =>
    new Date(iso).toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <>
      {/* Desktop table (sm and up) */}
      <div className="hidden sm:block overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[700px] text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-4 py-2 font-medium">Date &amp; time</th>
              <th className="px-4 py-2 font-medium">Customer</th>
              <th className="px-4 py-2 font-medium">Vehicle</th>
              <th className="px-4 py-2 font-medium">Type</th>
              <th className="px-4 py-2 font-medium">Technician</th>
              <th className="px-4 py-2 font-medium">Duration</th>
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr
                key={b.id}
                onClick={() => go(b.id)}
                className="border-t cursor-pointer transition-colors hover:bg-muted/40"
              >
                <td className="px-4 py-2.5 whitespace-nowrap">{fmtDateTime(b.scheduled_at)}</td>
                <td className="px-4 py-2.5">{b.customer?.full_name ?? "—"}</td>
                <td className="px-4 py-2.5 font-mono">{b.vehicle?.registration ?? "—"}</td>
                <td className="px-4 py-2.5">{typeLabel(b.type)}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{b.technicianName ?? "—"}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{b.duration_minutes} min</td>
                <td className="px-4 py-2.5">
                  <StatusPill status={b.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards (below sm) */}
      <ul className="sm:hidden flex flex-col gap-2">
        {rows.map((b) => (
          <li key={b.id}>
            <button
              onClick={() => go(b.id)}
              className="w-full rounded-lg border bg-card p-3 text-left transition-colors active:bg-muted/40"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium">{fmtDateTime(b.scheduled_at)}</span>
                <StatusPill status={b.status} />
              </div>
              <div className="mt-1.5 flex items-center gap-2 text-sm">
                <span>{b.customer?.full_name ?? "—"}</span>
                {b.vehicle?.registration && (
                  <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-medium">
                    {b.vehicle.registration}
                  </span>
                )}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {typeLabel(b.type)} · {b.duration_minutes} min
                {b.technicianName ? ` · ${b.technicianName}` : ""}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`inline-block shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
        STATUS_STYLE[status] ?? ""
      }`}
    >
      {statusLabel(status)}
    </span>
  );
}
