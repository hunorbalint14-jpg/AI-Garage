"use client";

import { useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import type { StatusCounts } from "@/lib/platform/reliability";

type Status = "all" | "operational" | "degraded" | "down";

const CHIPS: { key: Status; label: string; ring: string; dot: string }[] = [
  { key: "all", label: "All", ring: "border-[#3a414c]", dot: "" },
  { key: "operational", label: "Operational", ring: "border-[#2a5a3a]", dot: "bg-[#5fdd9d]" },
  { key: "degraded", label: "Degraded", ring: "border-[#5a4a1f]", dot: "bg-[#f5c451]" },
  { key: "down", label: "Down", ring: "border-[#5a2424]", dot: "bg-[#ff7b7b]" },
];

export function ReliabilityFilters({
  status,
  q,
  counts,
}: {
  status: Status;
  q: string;
  counts: StatusCounts;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [text, setText] = useState(q);

  function apply(updates: Record<string, string | null>) {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === "") p.delete(k);
      else p.set(k, v);
    }
    p.delete("page"); // any filter change returns to page 1
    router.push(`${pathname}?${p.toString()}`);
  }

  const countFor = (k: Status) =>
    k === "all" ? counts.total : k === "operational" ? counts.operational : k === "degraded" ? counts.degraded : counts.down;

  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap gap-2">
        {CHIPS.map((c) => {
          const on = status === c.key;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => apply({ status: c.key === "all" ? null : c.key })}
              className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                on ? `bg-[#1b2027] text-white ${c.ring}` : "border-[#2a2f37] bg-[#171b21] text-[#9aa1ad] hover:text-white"
              }`}
            >
              {c.dot && <span className={`h-2 w-2 rounded-full ${c.dot}`} />}
              {c.label}
              <b className="font-mono text-[#c7ccd4]">{countFor(c.key)}</b>
            </button>
          );
        })}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          apply({ q: text.trim() || null });
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Search slug or org…"
          className="w-56 rounded-lg border border-[#2a2f37] bg-[#171b21] px-3 py-1.5 text-sm text-white placeholder:text-[#5a6170] focus:border-[#22c55e] focus:outline-none"
        />
      </form>
    </div>
  );
}
