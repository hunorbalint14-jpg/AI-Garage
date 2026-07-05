import Link from "next/link";
import type { PriorityItem } from "@/lib/dashboard";

export function PriorityActions({ items }: { items: PriorityItem[] }) {
  return (
    <div className="rounded-md border border-border bg-card p-[22px]">
      <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        Priority actions
      </div>
      <div className="mb-4 text-base font-semibold text-foreground">
        Where to focus now
      </div>
      {items.map((p, i) => (
        <Link
          key={i}
          href={p.href}
          className={`grid grid-cols-[auto_1fr_auto] items-start gap-3 py-3 no-underline ${i ? "border-t border-border" : ""}`}
        >
          <span className="pt-0.5 font-mono text-[11px] text-muted-foreground">
            {p.n}
          </span>
          <div>
            <div className="text-[13px] font-semibold text-foreground">
              {p.title}
            </div>
            <div className="mt-[3px] text-xs leading-normal text-muted-foreground">
              {p.body}
            </div>
          </div>
          <div className="min-w-20 text-right">
            <div className="font-mono text-xs font-semibold text-[#5fdd9d]">
              {p.impact}
            </div>
            <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
              {p.urgency}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
