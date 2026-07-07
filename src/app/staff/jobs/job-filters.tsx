"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";

type Staff = { id: string; name: string };

// Search + technician filter for the jobs board, styled as workshop dark
// chips (UX review §1e). Mirrors the bookings page's assignee filter; both
// navigate with merged query params so they compose.
export function JobFilters({
  initialQ,
  staff,
  assignee,
}: {
  initialQ: string;
  staff: Staff[];
  assignee: string;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [q, setQ] = useState(initialQ);
  const [, startTransition] = useTransition();

  function push(params: URLSearchParams) {
    startTransition(() => router.push(`/staff/jobs?${params.toString()}`));
  }

  function applyQuery(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const params = new URLSearchParams(sp.toString());
    if (q.trim()) params.set("q", q.trim());
    else params.delete("q");
    push(params);
  }

  function applyAssignee(value: string) {
    const params = new URLSearchParams(sp.toString());
    if (value) params.set("assignee", value);
    else params.delete("assignee");
    push(params);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form onSubmit={applyQuery}>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ws-text-3" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Registration, customer, description…"
            className="w-72 rounded-[3px] border border-ws-border bg-ws-hover py-1.5 pl-8 pr-3 font-mono text-[11px] text-ws-text placeholder:text-ws-text-3 focus:outline-none focus:ring-1 focus:ring-ws-amber"
          />
        </div>
      </form>
      {staff.length > 0 && (
        <select
          value={assignee}
          onChange={(e) => applyAssignee(e.target.value)}
          className="rounded-[3px] border border-ws-border bg-ws-hover px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.04em] text-ws-text-2 focus:outline-none focus:ring-1 focus:ring-ws-amber"
          aria-label="Filter by technician"
        >
          <option value="">Tech: all</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
