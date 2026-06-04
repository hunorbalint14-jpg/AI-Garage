"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { PERIODS } from "@/lib/reports";

// Period preset for the VAT + productivity sections. Navigates ?period=.
export function PeriodSelector({ current }: { current: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function onChange(value: string) {
    const sp = new URLSearchParams(params.toString());
    sp.set("period", value);
    router.push(`${pathname}?${sp.toString()}`);
  }

  return (
    <select
      value={current}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border bg-background px-3 py-1.5 text-sm"
      aria-label="Reporting period"
    >
      {PERIODS.map((p) => (
        <option key={p.key} value={p.key}>{p.label}</option>
      ))}
    </select>
  );
}
