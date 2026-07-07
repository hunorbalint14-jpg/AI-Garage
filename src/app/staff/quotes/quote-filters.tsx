"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Search } from "lucide-react";

// Search + type filter for the quotes list, as workshop dark chips. The
// status filter lives in the pipeline cells now (UX review §1f) — this
// component no longer duplicates it. Both navigate with merged params.

const TYPES = [
  { value: "", label: "All types" },
  { value: "standalone", label: "Pre-job" },
  { value: "job", label: "DVI" },
];

export function QuoteFilters({
  initialQ,
  initialType,
}: {
  initialQ: string;
  initialType: string;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [q, setQ] = useState(initialQ);
  const [, startTransition] = useTransition();

  function push(params: URLSearchParams) {
    startTransition(() => router.push(`/staff/quotes?${params.toString()}`));
  }

  function applyType(value: string) {
    const params = new URLSearchParams(sp.toString());
    if (value) params.set("type", value); else params.delete("type");
    if (q.trim()) params.set("q", q.trim()); else params.delete("q");
    push(params);
  }

  function applyQuery(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const params = new URLSearchParams(sp.toString());
    if (q.trim()) params.set("q", q.trim()); else params.delete("q");
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
            placeholder="Title, customer, registration…"
            className="w-64 rounded-[3px] border border-ws-border bg-ws-hover py-1.5 pl-8 pr-3 font-mono text-[11px] text-ws-text placeholder:text-ws-text-3 focus:outline-none focus:ring-1 focus:ring-ws-amber"
          />
        </div>
      </form>
      <select
        value={initialType}
        onChange={(e) => applyType(e.target.value)}
        className="rounded-[3px] border border-ws-border bg-ws-hover px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.04em] text-ws-text-2 focus:outline-none focus:ring-1 focus:ring-ws-amber"
        aria-label="Filter by quote type"
      >
        {TYPES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>
    </div>
  );
}
