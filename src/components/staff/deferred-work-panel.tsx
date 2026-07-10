import Link from "next/link";
import { History } from "lucide-react";
import type { DeferredFinding } from "@/lib/deferred-work";

// "Previously advised" panel (#498): open deferred-work records for a
// vehicle — declined quote lines and never-quoted advisories — surfaced on
// the customer's vehicle list and on the job card so advised work isn't
// forgotten. Read-only here; lifecycle actions live on /staff/deferred
// (Phase 4).

const KIND_LABEL: Record<DeferredFinding["kind"], string> = {
  declined: "Declined",
  not_quoted: "Not quoted",
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
              {regByVehicleId && f.vehicleId && (
                <span className="mr-2 font-mono text-xs text-muted-foreground">
                  {regByVehicleId.get(f.vehicleId) ?? ""}
                </span>
              )}
              {f.description}
              <span className="ml-2 text-xs text-muted-foreground">
                {new Date(f.foundAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5 text-xs">
              {f.price !== null && (
                <span className="tabular-nums text-muted-foreground">£{f.price.toFixed(2)}</span>
              )}
              {f.rag && (
                <span
                  className={`rounded-md border px-1.5 py-0.5 font-semibold ${
                    f.rag === "red"
                      ? "border-red-500/50 bg-red-500/25 text-ws-red"
                      : "border-amber-500/50 bg-amber-500/25 text-ws-amber"
                  }`}
                >
                  {f.rag === "red" ? "Urgent" : "Advise"}
                </span>
              )}
              <span className="rounded-md border px-1.5 py-0.5 text-muted-foreground">{KIND_LABEL[f.kind]}</span>
              {f.jobId && (
                <Link
                  href={f.source === "inspection_item" ? `/staff/jobs/${f.jobId}/inspection` : `/staff/jobs/${f.jobId}`}
                  className="text-muted-foreground underline underline-offset-2"
                >
                  {f.source === "inspection_item" ? "Check →" : "Job →"}
                </Link>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
