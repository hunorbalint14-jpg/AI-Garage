"use client";

import Link from "next/link";

export type SegmentedItem = { value: string; label: string; href?: string };

// Segmented control (UX review §1b). Segments navigate (href — server pages
// keep state in the URL) or fire onChange (client state). Active segment is
// amber on the amber inset bg.
export function Segmented({
  items,
  value,
  onChange,
  className,
}: {
  items: SegmentedItem[];
  value: string;
  onChange?: (value: string) => void;
  className?: string;
}) {
  return (
    <div
      className={`inline-flex overflow-hidden rounded-[4px] border border-ws-border divide-x divide-ws-border${className ? ` ${className}` : ""}`}
    >
      {items.map((item) => {
        const active = item.value === value;
        const cls = `px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] no-underline transition-colors ${
          active ? "bg-ws-amber-bg text-ws-amber" : "text-ws-text-2 hover:text-ws-text"
        }`;
        return item.href !== undefined ? (
          <Link
            key={item.value}
            href={item.href}
            className={cls}
            aria-current={active ? "page" : undefined}
          >
            {item.label}
          </Link>
        ) : (
          <button
            key={item.value}
            type="button"
            onClick={() => onChange?.(item.value)}
            className={cls}
            aria-pressed={active}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
