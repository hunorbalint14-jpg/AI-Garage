import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import type { createAdminClient } from "@/lib/supabase/admin";

// Job-card entry for the eVHC flow (#497): start a check, or the RAG summary
// strip once one exists. Server component — data comes from the page.

export type InspectionSummary = {
  id: string;
  status: string;
  red: number;
  amber: number;
  green: number;
  unchecked: number;
} | null;

export async function inspectionSummary(
  admin: ReturnType<typeof createAdminClient>,
  jobId: string,
): Promise<InspectionSummary> {
  const { data } = await admin
    .from("inspections")
    .select("id, status, items:inspection_items(rag)")
    .eq("job_id", jobId)
    .maybeSingle();
  const row = data as unknown as { id: string; status: string; items: { rag: string }[] } | null;
  if (!row) return null;
  const count = (rag: string) => row.items.filter((i) => i.rag === rag).length;
  return {
    id: row.id,
    status: row.status,
    red: count("red"),
    amber: count("amber"),
    green: count("green"),
    unchecked: count("not_checked"),
  };
}

const STATUS_LABEL: Record<string, string> = {
  draft: "Started",
  in_progress: "In progress",
  complete: "Complete",
  sent: "Sent to customer",
};

export function InspectionCard({ jobId, summary }: { jobId: string; summary: InspectionSummary }) {
  return (
    <section className="rounded-lg border p-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <ClipboardCheck className="h-5 w-5 text-muted-foreground" />
        <div>
          <h2 className="text-sm font-semibold">Vehicle health check</h2>
          {summary ? (
            <p className="text-xs tabular-nums text-muted-foreground mt-0.5">
              {STATUS_LABEL[summary.status] ?? summary.status} ·{" "}
              <span className="text-ws-red font-semibold">{summary.red} red</span>
              {" · "}
              <span className="text-ws-amber font-semibold">{summary.amber} amber</span>
              {" · "}
              <span className="text-ws-green font-semibold">{summary.green} green</span>
              {summary.unchecked > 0 && <> · {summary.unchecked} unchecked</>}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground mt-0.5">
              RAG-grade the vehicle with photos — findings become a quote the customer approves item by item.
            </p>
          )}
        </div>
      </div>
      <Link
        href={`/staff/jobs/${jobId}/inspection`}
        className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted/40"
      >
        {summary ? (summary.status === "complete" || summary.status === "sent" ? "View check" : "Continue check") : "Start check"}
      </Link>
    </section>
  );
}
