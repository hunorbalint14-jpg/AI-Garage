import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { createInspectionReadUrls } from "@/lib/inspection-media";
import { InspectionCapture, type CaptureItem } from "./inspection-capture";
import { StartInspectionButton } from "./start-button";

// eVHC tech capture (#497 Phase 2). Mobile-first: this page is used on a
// phone in the workshop. The heavy lifting is the client component; this
// server page loads the inspection + signed photo URLs.

export default async function InspectionPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await isFeatureEnabled("evhc"))) notFound();
  const { id: jobId } = await params;
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  const { data: jobRow } = await admin
    .from("jobs")
    .select("id, location_id, description, status, vehicle:vehicles(registration, make, model), customer:customers(full_name)")
    .eq("id", jobId)
    .maybeSingle();
  type JobRow = {
    id: string;
    location_id: string;
    description: string | null;
    status: string;
    vehicle: { registration: string | null; make: string | null; model: string | null } | null;
    customer: { full_name: string | null } | null;
  };
  const job = jobRow as unknown as JobRow | null;
  if (!job || job.location_id !== ctx.location.id) notFound();

  const { data: inspRow } = await admin
    .from("inspections")
    .select("id, status, quote_id, items:inspection_items(id, section, label, rag, note, customer_summary, suggested_repair, suggested_price, outcome, template_item_id, sort_order, media:inspection_media(id, storage_path, mime))")
    .eq("job_id", jobId)
    .maybeSingle();

  type InspRow = {
    id: string;
    status: string;
    quote_id: string | null;
    items: {
      id: string;
      section: string;
      label: string;
      rag: string;
      note: string | null;
      customer_summary: string | null;
      suggested_repair: string | null;
      suggested_price: number | null;
      outcome: string;
      template_item_id: string | null;
      sort_order: number;
      media: { id: string; storage_path: string; mime: string | null }[];
    }[];
  };
  const inspection = inspRow as unknown as InspRow | null;

  const vehicleLine = [job.vehicle?.registration, [job.vehicle?.make, job.vehicle?.model].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(" · ");

  if (!inspection) {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-4">
        <div>
          <h1 className="text-xl font-semibold">Vehicle health check</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {vehicleLine || job.description || "This job"} — {job.customer?.full_name ?? "customer"}
          </p>
        </div>
        <div className="rounded-lg border p-5 flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Start a templated check: every item begins unchecked, you grade the exceptions
            red or amber with photos, then confirm the rest are OK in one tap.
          </p>
          <StartInspectionButton jobId={jobId} />
        </div>
        <Link href={`/staff/jobs/${jobId}`} className="text-sm text-muted-foreground underline underline-offset-2">
          ← Back to the job card
        </Link>
      </div>
    );
  }

  // Signed read URLs for every photo, one batched call.
  const allPaths = inspection.items.flatMap((it) => it.media.map((m) => m.storage_path));
  const urlMap = await createInspectionReadUrls(allPaths);

  const items: CaptureItem[] = inspection.items
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((it) => ({
      id: it.id,
      section: it.section,
      label: it.label,
      rag: it.rag as CaptureItem["rag"],
      note: it.note ?? "",
      customerSummary: it.customer_summary ?? "",
      suggestedRepair: it.suggested_repair,
      suggestedPrice: it.suggested_price,
      outcome: it.outcome as CaptureItem["outcome"],
      adhoc: it.template_item_id === null,
      media: it.media.map((m) => ({ id: m.id, url: urlMap.get(m.storage_path) ?? "", path: m.storage_path })),
    }));

  // The generated quote's status gates the quote panel (separate fetch — no
  // embed, so the quotes↔inspections double-FK ambiguity never bites).
  let initialQuote: { id: string; status: string } | null = null;
  if (inspection.quote_id) {
    const { data: q } = await admin
      .from("quotes")
      .select("id, status")
      .eq("id", inspection.quote_id)
      .maybeSingle();
    initialQuote = (q as { id: string; status: string } | null) ?? null;
  }

  return (
    <InspectionCapture
      jobId={jobId}
      inspectionId={inspection.id}
      status={inspection.status}
      vehicleLine={vehicleLine || job.description || ""}
      customerName={job.customer?.full_name ?? ""}
      initialItems={items}
      initialQuote={initialQuote}
    />
  );
}
