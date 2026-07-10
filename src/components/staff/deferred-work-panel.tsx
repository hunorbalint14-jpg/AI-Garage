import Link from "next/link";
import { History } from "lucide-react";
import type { DeferredFinding } from "@/lib/deferred-work";

// eVHC "Previously advised" panel (#497 Phase 6): declined / never-quoted
// amber+red findings for a vehicle, surfaced on the customer's vehicle list
// and on the job card so advised work isn't forgotten. Read-only — the
// action happens on the linked job's health check.

const OUTCOME_LABEL: Record<DeferredFinding["outcome"], string> = {
  none: "Not quoted",
  declined: "Declined",
};

export function DeferredWorkPanel({
  findings,
  regByVehicleId,
}: {
  findings: DeferredFinding[];
  /** When set, each row is prefixed with its vehicle's registration. */
  regByVehicleId?: Map<string, string | null>;
}) {
  if (findings.length === 0) return null;

  return (
    <section className="rounded-lg border">
      <h2 className="flex items-center gap-2 border-b px-4 py-2.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ws-text-3">
        <History className="h-3.5 w-3.5" /> Previously advised
      </h2>
      <ul>
        {findings.map((f) => (
          <li key={f.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b px-4 py-2.5 text-sm last:border-b-0">
            <span className="min-w-0">
              {regByVehicleId && (
                <span className="mr-2 font-mono text-xs text-muted-foreground">
                  {regByVehicleId.get(f.vehicleId) ?? ""}
                </span>
              )}
              {f.suggestedRepair ?? f.label}
              <span className="ml-2 text-xs text-muted-foreground">
                {new Date(f.foundAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5 text-xs">
              {f.suggestedPrice !== null && (
                <span className="tabular-nums text-muted-foreground">£{f.suggestedPrice.toFixed(2)}</span>
              )}
              <span
                className={`rounded-md border px-1.5 py-0.5 font-semibold ${
                  f.rag === "red"
                    ? "border-red-500/50 bg-red-500/25 text-ws-red"
                    : "border-amber-500/50 bg-amber-500/25 text-ws-amber"
                }`}
              >
                {f.rag === "red" ? "Urgent" : "Advise"}
              </span>
              <span className="rounded-md border px-1.5 py-0.5 text-muted-foreground">{OUTCOME_LABEL[f.outcome]}</span>
              <Link
                href={`/staff/jobs/${f.jobId}/inspection`}
                className="text-muted-foreground underline underline-offset-2"
              >
                Check →
              </Link>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
