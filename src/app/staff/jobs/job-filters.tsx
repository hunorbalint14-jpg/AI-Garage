"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

type Staff = { id: string; name: string };

// Search + technician filter for the jobs board. Mirrors the bookings page's
// assignee filter; both navigate with merged query params so they compose.
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
    <div className="flex flex-wrap items-center gap-3">
      <form onSubmit={applyQuery}>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Registration, customer, description…"
            className="w-72 pl-8"
          />
        </div>
      </form>
      {staff.length > 0 && (
        <select
          value={assignee}
          onChange={(e) => applyAssignee(e.target.value)}
          className="rounded-md border bg-background px-3 py-1.5 text-sm"
          aria-label="Filter by technician"
        >
          <option value="">All technicians</option>
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
