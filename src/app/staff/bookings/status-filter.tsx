"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { statusLabel } from "./booking-display";

// Order shown in the dropdown. Mirrors the booking lifecycle.
const STATUSES = [
  "scheduled",
  "in_progress",
  "complete",
  "payment_pending",
  "no_show",
  "cancelled",
];

// "By status" filter for the bookings schedule. Navigates preserving the other
// params (view/filter/month/assignee) so it composes with the existing toggles.
export function StatusFilter({ current }: { current: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function onChange(value: string) {
    const sp = new URLSearchParams(params.toString());
    if (value) sp.set("status", value);
    else sp.delete("status");
    router.push(`${pathname}?${sp.toString()}`);
  }

  return (
    <select
      value={current}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-[3px] border border-ws-border bg-ws-hover px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.04em] text-ws-text-2 focus:outline-none focus:ring-1 focus:ring-ws-amber"
      aria-label="Filter by status"
    >
      <option value="">Status: all</option>
      {STATUSES.map((s) => (
        <option key={s} value={s}>
          {statusLabel(s)}
        </option>
      ))}
    </select>
  );
}
