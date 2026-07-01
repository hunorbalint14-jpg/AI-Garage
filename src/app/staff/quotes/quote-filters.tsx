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

const TYPES = [
  { value: "", label: "All types" },
  { value: "standalone", label: "Pre-job" },
  { value: "job", label: "DVI" },
];

export function QuoteFilters({
  initialQ,
  initialStatus,
  initialType,
}: {
  initialQ: string;
  initialStatus: string;
  initialType: string;
}) {
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

  function applyType(value: string) {
    const params = new URLSearchParams(sp.toString());
    if (value) params.set("type", value); else params.delete("type");
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
    <div className="flex flex-wrap gap-3 items-center">
      <form onSubmit={applyQuery} className="flex items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Title, customer, registration…"
            className="pl-8 w-72"
          />
        </div>
      </form>
      <div className="flex flex-wrap gap-1">
        {TYPES.map((t) => {
          const active = (initialType || "") === t.value;
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => applyType(t.value)}
              className={
                "rounded-full px-3 py-1 text-xs font-medium " +
                (active ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:bg-muted/70")
              }
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-1">
        {STATUSES.map((s) => {
          const active = (initialStatus || "") === s.value;
          return (
            <button
              key={s.value}
              type="button"
              onClick={() => applyStatus(s.value)}
              className={
                "rounded-full px-3 py-1 text-xs font-medium " +
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
