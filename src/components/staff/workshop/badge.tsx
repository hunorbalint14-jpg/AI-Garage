import type { ReactNode } from "react";

export type WorkshopTone = "amber" | "green" | "red" | "blue" | "purple" | "neutral";

const TONES: Record<WorkshopTone, string> = {
  amber: "border-ws-amber-border bg-ws-amber-bg text-ws-amber",
  green: "border-ws-green-border bg-ws-green-bg text-ws-green",
  red: "border-ws-red-border bg-ws-red-bg text-ws-red",
  blue: "border-ws-blue-border bg-ws-blue-bg text-ws-blue",
  purple: "border-ws-purple-border bg-ws-purple-bg text-ws-purple",
  neutral: "border-ws-border bg-ws-hover text-ws-text-2",
};

// Square bordered mono status badge — the staff portal's one badge shape
// (UX review §1b). Replaces rounded-full pills and light bg-*-100 classes.
export function WorkshopBadge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: WorkshopTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-[2px] border px-2 py-[3px] font-mono text-[10px] font-semibold uppercase tracking-[0.1em] ${TONES[tone]}${className ? ` ${className}` : ""}`}
    >
      {children}
    </span>
  );
}
