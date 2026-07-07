import type { ReactNode } from "react";

// Mono microcaps section label (UX review §1b) — the one way to caption a
// section or column in the staff portal.
export function MicroLabel({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={`font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ws-text-3${className ? ` ${className}` : ""}`}
    >
      {children}
    </div>
  );
}
