"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

const STATUSES = [
  { value: "", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "declined", label: "Declined" },
  { value: "expired", label: "Expired" },
  { value: "cancelled", label: "Cancelled" },
];

export function QuoteFilters({ initialQ, initialStatus }: { initialQ: string; initialStatus: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [q, setQ] = useState(initialQ);
  const [, startTransition] = useTransition();

  function applyStatus(value: string) {
    const params = new URLSearchParams(sp.toString());
    if (value) params.set("status", value); else params.delete("status");
    if (q.trim()) params.set("q", q.trim()); else params.delete("q");
    startTransition(() => router.push(`/staff/quotes?${params.toString()}`));
  }

  function applyQuery(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const params = new URLSearchParams(sp.toString());
    if (q.trim()) params.set("q", q.trim()); else params.delete("q");
    startTransition(() => router.push(`/staff/quotes?${params.toString()}`));
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3 w-full sm:w-auto">
      <form onSubmit={applyQuery} className="w-full sm:w-auto">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Title, customer, registration…"
            className="pl-8 w-full"
          />
        </div>
      </form>
      <div className="-mx-1 flex gap-1 overflow-x-auto px-1 sm:flex-wrap sm:overflow-visible">
        {STATUSES.map((s) => {
          const active = (initialStatus || "") === s.value;
          return (
            <button
              key={s.value}
              type="button"
              onClick={() => applyStatus(s.value)}
              className={
                "shrink-0 rounded-full px-3 py-1 text-xs font-medium " +
                (active ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:bg-muted/70")
              }
            >
              {s.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
