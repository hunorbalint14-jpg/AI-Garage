"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { hasPermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { logAudit } from "@/lib/audit";
import {
  inspectionPhotoPath,
  createInspectionUploadUrl,
  inspectionMediaExists,
  deleteInspectionMediaObject,
  isAllowedInspectionMime,
  INSPECTION_PHOTO_MAX_BYTES,
  INSPECTION_PHOTO_MAX_COUNT,
} from "@/lib/inspection-media";
import {
  rewriteInspectionFindings,
  type CatalogueLine,
  type FindingInput,
  type FindingRewrite,
} from "@/lib/ai-inspection";
import { getOrgAiBrief } from "@/lib/ai-profile";
import { createQuote } from "../quote-actions";
import { generateCheckToken, generateCheckSlug, hashCheckToken, tenantCheckUrl } from "@/lib/inspection-links";
import { generateQuoteToken, generateQuoteSlug, hashQuoteToken } from "@/lib/quote-links";
import { encryptLinkToken } from "@/lib/quote-reminders";
import { garageLabel, garageLocationBlock, garageLocationInline } from "@/lib/garage-identity";
import { sendEmail } from "@/lib/email";
import { sendSms } from "@/lib/sms";
import { sendWhatsApp } from "@/lib/whatsapp";

// eVHC Phase 2 (#497): tech capture flow server actions. Every mutation
// re-verifies that the inspection belongs to the caller's active branch —
// the client only ever holds ids. All actions are per-interaction autosaves,
// so they must stay small and idempotent-ish (last write wins per field).

export type ActionResult = { error: string } | { success: true };

type Admin = ReturnType<typeof createAdminClient>;

async function guard(): Promise<
  { error: string } | { ctx: Awaited<ReturnType<typeof requireStaffContext>>; admin: Admin }
> {
  if (!(await isFeatureEnabled("evhc"))) return { error: "Health checks are not enabled." };
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "bookings")) return { error: "Permission denied." };
  return { ctx, admin: createAdminClient() };
}

// Load an inspection row iff it belongs to the caller's branch.
async function ownInspection(admin: Admin, locationId: string, inspectionId: string) {
  const { data } = await admin
    .from("inspections")
    .select("id, location_id, job_id, status")
    .eq("id", inspectionId)
    .maybeSingle();
  const row = data as { id: string; location_id: string; job_id: string; status: string } | null;
  return row && row.location_id === locationId ? row : null;
}

// Resolve an item through its inspection to the caller's branch.
async function ownItem(admin: Admin, locationId: string, itemId: string) {
  const { data } = await admin
    .from("inspection_items")
    .select(
      "id, template_item_id, section, label, rag, note, inspection:inspections(id, location_id, job_id, status, vehicle:vehicles(registration, make, model))",
    )
    .eq("id", itemId)
    .maybeSingle();
  const row = data as unknown as {
    id: string;
    template_item_id: string | null;
    section: string;
    label: string;
    rag: string;
    note: string | null;
    inspection: {
      id: string;
      location_id: string;
      job_id: string;
      status: string;
      vehicle: VehicleRow | null;
    } | null;
  } | null;
  if (!row?.inspection || row.inspection.location_id !== locationId) return null;
  return row;
}

type VehicleRow = { registration: string | null; make: string | null; model: string | null };

function vehicleLine(v: VehicleRow | null): string {
  return [v?.registration, [v?.make, v?.model].filter(Boolean).join(" ")].filter(Boolean).join(" ");
}

// Create (or return) the job's inspection, snapshotting the org's first
// active template into items. One inspection per job in the MVP.
export async function startInspection(
  jobId: string,
): Promise<{ error: string } | { success: true; inspectionId: string }> {
  const g = await guard();
  if ("error" in g) return g;
  const { ctx, admin } = g;

  const { data: job } = await admin
    .from("jobs")
    .select("id, location_id, vehicle_id, status")
    .eq("id", jobId)
    .maybeSingle();
  const jobRow = job as { id: string; location_id: string; vehicle_id: string | null; status: string } | null;
  if (!jobRow || jobRow.location_id !== ctx.location.id) return { error: "Job not found." };

  const { data: existing } = await admin
    .from("inspections")
    .select("id")
    .eq("job_id", jobId)
    .maybeSingle();
  if (existing) return { success: true, inspectionId: (existing as { id: string }).id };

  const { data: template } = await admin
    .from("inspection_templates")
    .select("id, items:inspection_template_items(id, section, label, sort_order)")
    .eq("organization_id", ctx.organization.id)
    .eq("active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const tpl = template as unknown as {
    id: string;
    items: { id: string; section: string; label: string; sort_order: number }[];
  } | null;

  const { data: inspection, error: insErr } = await admin
    .from("inspections")
    .insert({
      location_id: ctx.location.id,
      job_id: jobId,
      vehicle_id: jobRow.vehicle_id,
      template_id: tpl?.id ?? null,
      performed_by: ctx.user.id,
      status: "draft",
    })
    .select("id")
    .single();
  if (insErr || !inspection) return { error: insErr?.message ?? "Could not create the inspection." };

  if (tpl && tpl.items.length > 0) {
    const { error: itemsErr } = await admin.from("inspection_items").insert(
      tpl.items
        .slice()
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((it) => ({
          inspection_id: inspection.id,
          template_item_id: it.id,
          section: it.section,
          label: it.label,
          sort_order: it.sort_order,
        })),
    );
    if (itemsErr) {
      await admin.from("inspections").delete().eq("id", inspection.id);
      return { error: itemsErr.message };
    }
  }

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "inspection.start",
    entityType: "inspection",
    entityId: inspection.id,
    metadata: { job_id: jobId, template_id: tpl?.id ?? null, item_count: tpl?.items.length ?? 0 },
  });

  revalidatePath(`/staff/jobs/${jobId}`);
  return { success: true, inspectionId: inspection.id };
}

// Autosave a single item's RAG and/or note. Bumps the inspection into
// in_progress on the first touch.
export async function updateInspectionItem(
  itemId: string,
  patch: { rag?: "green" | "amber" | "red" | "not_checked"; note?: string },
): Promise<ActionResult> {
  const g = await guard();
  if ("error" in g) return g;
  const { ctx, admin } = g;

  const item = await ownItem(admin, ctx.location.id, itemId);
  if (!item) return { error: "Item not found." };
  if (item.inspection!.status === "sent") return { error: "This report has been sent — it can no longer be edited." };

  const update: Record<string, unknown> = {};
  if (patch.rag) {
    if (!["green", "amber", "red", "not_checked"].includes(patch.rag)) return { error: "Invalid grade." };
    update.rag = patch.rag;
  }
  if (patch.note !== undefined) update.note = patch.note.trim().slice(0, 2000) || null;
  if (Object.keys(update).length === 0) return { success: true };

  const { error } = await admin.from("inspection_items").update(update).eq("id", itemId);
  if (error) return { error: error.message };

  if (item.inspection!.status === "draft") {
    await admin.from("inspections").update({ status: "in_progress", updated_at: new Date().toISOString() }).eq("id", item.inspection!.id);
  }
  return { success: true };
}

// Ad-hoc finding outside the template.
export async function addInspectionFinding(
  inspectionId: string,
  args: { section?: string; label: string },
): Promise<{ error: string } | { success: true; itemId: string }> {
  const g = await guard();
  if ("error" in g) return g;
  const { ctx, admin } = g;

  const inspection = await ownInspection(admin, ctx.location.id, inspectionId);
  if (!inspection) return { error: "Inspection not found." };
  if (inspection.status === "sent") return { error: "This report has been sent — it can no longer be edited." };

  const label = args.label.trim().slice(0, 200);
  if (!label) return { error: "Describe the finding." };
  const section = args.section?.trim().slice(0, 100) || "Other findings";

  const { data: maxRow } = await admin
    .from("inspection_items")
    .select("sort_order")
    .eq("inspection_id", inspectionId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const sort = ((maxRow as { sort_order: number } | null)?.sort_order ?? 0) + 10;

  const { data, error } = await admin
    .from("inspection_items")
    .insert({ inspection_id: inspectionId, section, label, sort_order: sort, rag: "amber" })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Could not add the finding." };
  return { success: true, itemId: data.id };
}

// Remove an ad-hoc finding (template rows can only be re-graded, not removed).
export async function removeInspectionFinding(itemId: string): Promise<ActionResult> {
  const g = await guard();
  if ("error" in g) return g;
  const { ctx, admin } = g;

  const item = await ownItem(admin, ctx.location.id, itemId);
  if (!item) return { error: "Item not found." };
  if (item.template_item_id) return { error: "Template items can't be removed — grade them instead." };
  if (item.inspection!.status === "sent") return { error: "This report has been sent — it can no longer be edited." };

  const { error } = await admin.from("inspection_items").delete().eq("id", itemId);
  if (error) return { error: error.message };
  return { success: true };
}

// "Everything else OK" — sweep the not-yet-checked items to green.
export async function sweepRemainingGreen(inspectionId: string): Promise<ActionResult> {
  const g = await guard();
  if ("error" in g) return g;
  const { ctx, admin } = g;

  const inspection = await ownInspection(admin, ctx.location.id, inspectionId);
  if (!inspection) return { error: "Inspection not found." };
  if (inspection.status === "sent") return { error: "This report has been sent — it can no longer be edited." };

  const { error } = await admin
    .from("inspection_items")
    .update({ rag: "green" })
    .eq("inspection_id", inspectionId)
    .eq("rag", "not_checked");
  if (error) return { error: error.message };
  if (inspection.status === "draft") {
    await admin.from("inspections").update({ status: "in_progress" }).eq("id", inspectionId);
  }
  return { success: true };
}

export async function completeInspection(inspectionId: string): Promise<ActionResult> {
  const g = await guard();
  if ("error" in g) return g;
  const { ctx, admin } = g;

  const inspection = await ownInspection(admin, ctx.location.id, inspectionId);
  if (!inspection) return { error: "Inspection not found." };
  if (inspection.status === "sent") return { error: "This report has already been sent." };

  const { count } = await admin
    .from("inspection_items")
    .select("id", { count: "exact", head: true })
    .eq("inspection_id", inspectionId)
    .eq("rag", "not_checked");
  if ((count ?? 0) > 0) {
    return { error: `${count} item${count === 1 ? "" : "s"} unchecked — grade them or tap "Everything else OK" first.` };
  }

  const { error } = await admin
    .from("inspections")
    .update({ status: "complete", updated_at: new Date().toISOString() })
    .eq("id", inspectionId);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "inspection.complete",
    entityType: "inspection",
    entityId: inspectionId,
    metadata: { job_id: inspection.job_id },
  });

  revalidatePath(`/staff/jobs/${inspection.job_id}`);
  return { success: true };
}

// Mint a signed PUT URL for a finding photo (client uploads directly to
// storage, then calls attachInspectionMedia with the same path).
export async function prepareInspectionPhoto(
  itemId: string,
  args: { mime: string; sizeBytes: number },
): Promise<{ error: string } | { success: true; path: string; url: string }> {
  const g = await guard();
  if ("error" in g) return g;
  const { ctx, admin } = g;

  const item = await ownItem(admin, ctx.location.id, itemId);
  if (!item) return { error: "Item not found." };
  if (item.inspection!.status === "sent") return { error: "This report has been sent — it can no longer be edited." };
  if (!isAllowedInspectionMime(args.mime)) return { error: "Photos must be JPEG, PNG or WebP." };
  if (args.sizeBytes > INSPECTION_PHOTO_MAX_BYTES) return { error: "Photo is too large (10 MB max)." };

  const { count } = await admin
    .from("inspection_media")
    .select("id", { count: "exact", head: true })
    .eq("inspection_item_id", itemId);
  if ((count ?? 0) >= INSPECTION_PHOTO_MAX_COUNT) {
    return { error: `Up to ${INSPECTION_PHOTO_MAX_COUNT} photos per finding.` };
  }

  const path = inspectionPhotoPath(ctx.location.id, item.inspection!.id, itemId, args.mime);
  const minted = await createInspectionUploadUrl(path);
  if ("error" in minted) return minted;
  return { success: true, path, url: minted.url };
}

// Trust a path into the DB only after verifying the object actually exists.
export async function attachInspectionMedia(
  itemId: string,
  args: { path: string; mime: string; sizeBytes: number },
): Promise<{ error: string } | { success: true; mediaId: string }> {
  const g = await guard();
  if ("error" in g) return g;
  const { ctx, admin } = g;

  const item = await ownItem(admin, ctx.location.id, itemId);
  if (!item) return { error: "Item not found." };
  // The path must be one we would have minted for this item.
  if (!args.path.startsWith(`${ctx.location.id}/${item.inspection!.id}/${itemId}/`)) {
    return { error: "Invalid photo path." };
  }
  if (!(await inspectionMediaExists(args.path))) return { error: "Upload not found — try again." };

  const { data, error } = await admin
    .from("inspection_media")
    .insert({
      inspection_item_id: itemId,
      storage_path: args.path,
      mime: args.mime,
      size_bytes: args.sizeBytes,
    })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Could not save the photo." };
  return { success: true, mediaId: data.id };
}

export async function removeInspectionMedia(mediaId: string): Promise<ActionResult> {
  const g = await guard();
  if ("error" in g) return g;
  const { ctx, admin } = g;

  const { data } = await admin
    .from("inspection_media")
    .select("id, storage_path, item:inspection_items(id, inspection:inspections(id, location_id, status))")
    .eq("id", mediaId)
    .maybeSingle();
  const row = data as unknown as {
    id: string;
    storage_path: string;
    item: { inspection: { location_id: string; status: string } | null } | null;
  } | null;
  if (!row?.item?.inspection || row.item.inspection.location_id !== ctx.location.id) {
    return { error: "Photo not found." };
  }
  if (row.item.inspection.status === "sent") return { error: "This report has been sent — it can no longer be edited." };

  const { error } = await admin.from("inspection_media").delete().eq("id", mediaId);
  if (error) return { error: error.message };
  await deleteInspectionMediaObject(row.storage_path);
  return { success: true };
}

// ── AI findings rewrite (Phase 3) ──────────────────────────────────────────
// Shorthand notes → customer_summary + a suggested repair line matched against
// the branch's services/products catalogue. AI failure never blocks the flow:
// the batch action falls back to the raw note, and every summary stays
// editable until the report is sent.

export type SummaryPatch = {
  id: string;
  customerSummary: string;
  suggestedRepair: string | null;
  suggestedPrice: number | null;
};

const AI_FEATURE = "inspection_rewrite";

// The branch's active price list, services first. Capped — this is prompt
// context, not a data sync.
async function loadCatalogue(admin: Admin, locationId: string): Promise<CatalogueLine[]> {
  const [svc, prod] = await Promise.all([
    admin.from("services").select("id, name, price").eq("location_id", locationId).eq("active", true).order("name").limit(100),
    admin.from("products").select("id, name, unit_price").eq("location_id", locationId).eq("active", true).order("name").limit(50),
  ]);
  const services = ((svc.data ?? []) as { id: string; name: string; price: number | null }[]).map((s) => ({
    kind: "service" as const,
    id: s.id,
    name: s.name,
    price: s.price,
  }));
  const products = ((prod.data ?? []) as { id: string; name: string; unit_price: number | null }[]).map((p) => ({
    kind: "product" as const,
    id: p.id,
    name: p.name,
    price: p.unit_price,
  }));
  return [...services, ...products];
}

// Turn one AI rewrite into the DB column patch, resolving the catalogue pick
// to a real row (price snapshot + id refs for Phase 4's VAT lookup).
function suggestionUpdate(rw: FindingRewrite, catalogue: CatalogueLine[]) {
  const entry = rw.catalogueIndex !== null ? catalogue[rw.catalogueIndex - 1] : undefined;
  return {
    customer_summary: rw.summary,
    suggested_repair: rw.repair,
    suggested_price: entry?.price ?? null,
    suggested_service_id: entry?.kind === "service" ? entry.id : null,
    suggested_product_id: entry?.kind === "product" ? entry.id : null,
  };
}

// Batch rewrite for every amber/red finding that doesn't have a summary yet
// (manual edits are never clobbered — per-item rewrite is the explicit
// overwrite). On AI failure the raw note (or the item label) becomes the
// summary so the report can always be sent.
export async function generateInspectionSummaries(
  inspectionId: string,
): Promise<{ error: string } | { success: true; aiUsed: boolean; items: SummaryPatch[] }> {
  const g = await guard();
  if ("error" in g) return g;
  const { ctx, admin } = g;

  const inspection = await ownInspection(admin, ctx.location.id, inspectionId);
  if (!inspection) return { error: "Inspection not found." };
  if (inspection.status === "sent") return { error: "This report has been sent — it can no longer be edited." };

  const { data: itemRows } = await admin
    .from("inspection_items")
    .select("id, section, label, rag, note, customer_summary")
    .eq("inspection_id", inspectionId)
    .in("rag", ["amber", "red"])
    .order("sort_order", { ascending: true });
  const rows = (itemRows ?? []) as {
    id: string;
    section: string;
    label: string;
    rag: "amber" | "red";
    note: string | null;
    customer_summary: string | null;
  }[];
  const targets = rows.filter((r) => !r.customer_summary?.trim());
  if (targets.length === 0) return { success: true, aiUsed: true, items: [] };

  const { data: vehRow } = await admin
    .from("inspections")
    .select("vehicle:vehicles(registration, make, model)")
    .eq("id", inspectionId)
    .maybeSingle();
  const vehicle = vehicleLine((vehRow as unknown as { vehicle: VehicleRow | null } | null)?.vehicle ?? null);

  const catalogue = await loadCatalogue(admin, ctx.location.id);
  const findings: FindingInput[] = targets.map((t) => ({
    id: t.id,
    section: t.section,
    label: t.label,
    rag: t.rag,
    note: t.note,
  }));

  let rewrites: FindingRewrite[] = [];
  let aiUsed = true;
  try {
    const aiBrief = await getOrgAiBrief(admin, ctx.organization.id).catch(() => null);
    rewrites = await rewriteInspectionFindings(
      { vehicle, findings, catalogue, aiBrief },
      { locationId: ctx.location.id, organizationId: ctx.organization.id, userId: ctx.user.id, feature: AI_FEATURE },
    );
  } catch {
    aiUsed = false;
  }

  const byId = new Map(rewrites.map((r) => [r.id, r]));
  const patches: SummaryPatch[] = [];
  const writes = targets.map((t) => {
    const rw = byId.get(t.id);
    // A finding the model skipped gets the note fallback too.
    const update = rw
      ? suggestionUpdate(rw, catalogue)
      : { customer_summary: t.note?.trim() || t.label };
    patches.push({
      id: t.id,
      customerSummary: update.customer_summary,
      suggestedRepair: "suggested_repair" in update ? update.suggested_repair : null,
      suggestedPrice: "suggested_price" in update ? update.suggested_price : null,
    });
    return admin.from("inspection_items").update(update).eq("id", t.id);
  });
  const results = await Promise.all(writes);
  const failed = results.find((r) => r.error);
  if (failed?.error) return { error: failed.error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "inspection.ai_summaries",
    entityType: "inspection",
    entityId: inspectionId,
    metadata: { finding_count: targets.length, ai_used: aiUsed },
  });

  return { success: true, aiUsed, items: patches };
}

// Explicit per-item regenerate — overwrites whatever is there. No silent
// fallback here: the user asked for AI specifically, so surface the failure.
export async function rewriteInspectionFinding(
  itemId: string,
): Promise<{ error: string } | { success: true; item: SummaryPatch }> {
  const g = await guard();
  if ("error" in g) return g;
  const { ctx, admin } = g;

  const item = await ownItem(admin, ctx.location.id, itemId);
  if (!item) return { error: "Item not found." };
  if (item.inspection!.status === "sent") return { error: "This report has been sent — it can no longer be edited." };
  if (item.rag !== "amber" && item.rag !== "red") {
    return { error: "Only amber or red findings need customer wording." };
  }

  const catalogue = await loadCatalogue(admin, ctx.location.id);
  let rewrite: FindingRewrite | undefined;
  try {
    const aiBrief = await getOrgAiBrief(admin, ctx.organization.id).catch(() => null);
    [rewrite] = await rewriteInspectionFindings(
      {
        vehicle: vehicleLine(item.inspection!.vehicle),
        findings: [{ id: item.id, section: item.section, label: item.label, rag: item.rag, note: item.note }],
        catalogue,
        aiBrief,
      },
      { locationId: ctx.location.id, organizationId: ctx.organization.id, userId: ctx.user.id, feature: AI_FEATURE },
    );
  } catch {
    // fall through to the shared error below
  }
  if (!rewrite) return { error: "AI rewrite failed — try again, or write the summary yourself." };

  const update = suggestionUpdate(rewrite, catalogue);
  const { error } = await admin.from("inspection_items").update(update).eq("id", itemId);
  if (error) return { error: error.message };

  return {
    success: true,
    item: {
      id: itemId,
      customerSummary: update.customer_summary,
      suggestedRepair: update.suggested_repair,
      suggestedPrice: update.suggested_price,
    },
  };
}

// Manual summary edit (autosaved from the review card).
export async function updateInspectionSummary(itemId: string, summary: string): Promise<ActionResult> {
  const g = await guard();
  if ("error" in g) return g;
  const { ctx, admin } = g;

  const item = await ownItem(admin, ctx.location.id, itemId);
  if (!item) return { error: "Item not found." };
  if (item.inspection!.status === "sent") return { error: "This report has been sent — it can no longer be edited." };

  const { error } = await admin
    .from("inspection_items")
    .update({ customer_summary: summary.trim().slice(0, 1000) || null })
    .eq("id", itemId);
  if (error) return { error: error.message };
  return { success: true };
}

// ── Quote generation (Phase 4) ─────────────────────────────────────────────
// "Quote the red & amber items": one draft unified quote (quote_type='job',
// the EXISTING pipeline — revisions, reminders, expiry, deposits all come
// free) with one line per selected finding. Line description is the
// customer_summary (falls back to note → label); price is staff-confirmed in
// the panel, prefilled from the AI suggestion. Findings flip to
// outcome='quoted' and the inspection stamps quote_id.

export async function generateInspectionQuote(
  inspectionId: string,
  selections: { itemId: string; price: number }[],
): Promise<{ error: string } | { success: true; quoteId: string; quotedItemIds: string[] }> {
  if (!(await isFeatureEnabled("evhc"))) return { error: "Health checks are not enabled." };
  const ctx = await requireStaffContext();
  // Quote creation is gated by the quote permission, not the capture one.
  if (!hasPermission(ctx, "quotes_draft")) return { error: "Permission denied." };
  const admin = createAdminClient();

  const inspection = await ownInspection(admin, ctx.location.id, inspectionId);
  if (!inspection) return { error: "Inspection not found." };
  if (inspection.status !== "complete") {
    return { error: "Complete the check before quoting the findings." };
  }
  if (selections.length === 0) return { error: "Select at least one finding to quote." };
  for (const s of selections) {
    if (!Number.isFinite(s.price) || s.price < 0) return { error: "Every selected finding needs a price of £0 or more." };
  }

  // Existing quote: block while it's live; a cancelled one releases its
  // findings back to 'none' so the check can be re-quoted.
  const { data: inspRow } = await admin
    .from("inspections")
    .select("quote_id")
    .eq("id", inspectionId)
    .maybeSingle();
  const existingQuoteId = (inspRow as { quote_id: string | null } | null)?.quote_id ?? null;
  if (existingQuoteId) {
    const { data: q } = await admin.from("quotes").select("id, status").eq("id", existingQuoteId).maybeSingle();
    const status = (q as { status: string } | null)?.status;
    if (status && status !== "cancelled") {
      return { error: "A quote already exists for this check — cancel it before creating a new one." };
    }
    const { data: oldLines } = await admin
      .from("quote_items")
      .select("inspection_item_id")
      .eq("quote_id", existingQuoteId)
      .not("inspection_item_id", "is", null);
    const oldIds = ((oldLines ?? []) as { inspection_item_id: string }[]).map((r) => r.inspection_item_id);
    if (oldIds.length > 0) {
      await admin.from("inspection_items").update({ outcome: "none" }).in("id", oldIds).eq("outcome", "quoted");
    }
    await admin.from("inspections").update({ quote_id: null }).eq("id", inspectionId);
  }

  // Re-validate every selection server-side: right inspection, amber/red,
  // not already quoted/approved/declined.
  const ids = selections.map((s) => s.itemId);
  const { data: itemRows } = await admin
    .from("inspection_items")
    .select("id, section, label, rag, note, customer_summary, outcome, sort_order")
    .eq("inspection_id", inspectionId)
    .in("id", ids);
  const rows = (itemRows ?? []) as {
    id: string;
    section: string;
    label: string;
    rag: string;
    note: string | null;
    customer_summary: string | null;
    outcome: string;
    sort_order: number;
  }[];
  if (rows.length !== selections.length) return { error: "Some findings no longer exist — reload and try again." };
  for (const r of rows) {
    if (r.rag !== "amber" && r.rag !== "red") return { error: `"${r.label}" is not an advisory finding.` };
    if (r.outcome !== "none") return { error: `"${r.label}" is already on a quote.` };
  }

  const priceById = new Map(selections.map((s) => [s.itemId, s.price]));
  const items = rows
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((r) => ({
      description: r.customer_summary?.trim() || r.note?.trim() || r.label,
      type: "other" as const,
      quantity: 1,
      unit_price: priceById.get(r.id)!,
      inspection_item_id: r.id,
    }));

  const result = await createQuote({
    jobId: inspection.job_id,
    title: "Vehicle health check — recommended work",
    items,
    asDraft: true,
  });
  if ("error" in result) return result;

  const quotedItemIds = rows.map((r) => r.id);
  const [{ error: stampErr }, { error: outcomeErr }] = await Promise.all([
    admin.from("inspections").update({ quote_id: result.quoteId }).eq("id", inspectionId),
    admin.from("inspection_items").update({ outcome: "quoted" }).in("id", quotedItemIds),
  ]);
  if (stampErr || outcomeErr) return { error: (stampErr ?? outcomeErr)!.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "inspection.quote_created",
    entityType: "inspection",
    entityId: inspectionId,
    metadata: { quote_id: result.quoteId, job_id: inspection.job_id, finding_count: quotedItemIds.length, total: result.total },
  });

  revalidatePath(`/staff/jobs/${inspection.job_id}`);
  return { success: true, quoteId: result.quoteId, quotedItemIds };
}

// ── Send the customer report (Phase 5) ─────────────────────────────────────
// Mints the /check/[slug] token (sha256 stored, raw shown once), flips a
// draft findings-quote to pending so the report page can drive its per-item
// approval, and notifies the customer with the BRANCH identity (multi-site
// rule). Resend re-mints — the old link stops working.

export async function sendInspectionReport(
  inspectionId: string,
  opts?: { sms?: boolean; whatsapp?: boolean },
): Promise<{ error: string } | { success: true; url: string; channels: string[] }> {
  if (!(await isFeatureEnabled("evhc"))) return { error: "Health checks are not enabled." };
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "quotes_send")) return { error: "Permission denied." };
  const admin = createAdminClient();

  const inspection = await ownInspection(admin, ctx.location.id, inspectionId);
  if (!inspection) return { error: "Inspection not found." };
  if (inspection.status !== "complete" && inspection.status !== "sent") {
    return { error: "Complete the check before sending the report." };
  }

  // Customer + vehicle + counts for the message.
  const { data: jobRow } = await admin
    .from("jobs")
    .select("id, customer:customers(full_name, email, phone), vehicle:vehicles(registration, make, model)")
    .eq("id", inspection.job_id)
    .maybeSingle();
  const job = jobRow as unknown as {
    id: string;
    customer: { full_name: string | null; email: string | null; phone: string | null } | null;
    vehicle: VehicleRow | null;
  } | null;
  const customer = job?.customer;
  if (!customer?.email && !customer?.phone) {
    return { error: "Customer has no email or phone — cannot send the report." };
  }

  const { data: countRows } = await admin
    .from("inspection_items")
    .select("rag")
    .eq("inspection_id", inspectionId);
  const rags = ((countRows ?? []) as { rag: string }[]).map((r) => r.rag);
  const red = rags.filter((r) => r === "red").length;
  const amber = rags.filter((r) => r === "amber").length;
  const green = rags.filter((r) => r === "green").length;

  // Draft findings-quote goes pending now: the report page drives its
  // per-item approval, so it needs a live token (stored encrypted for the
  // reminder cron, like every sent quote).
  const { data: inspFull } = await admin
    .from("inspections")
    .select("quote_id")
    .eq("id", inspectionId)
    .maybeSingle();
  const quoteId = (inspFull as { quote_id: string | null } | null)?.quote_id ?? null;
  if (quoteId) {
    const { data: q } = await admin.from("quotes").select("id, status").eq("id", quoteId).maybeSingle();
    if ((q as { status: string } | null)?.status === "draft") {
      const { data: orgRow } = await admin
        .from("organizations")
        .select("quote_validity_days")
        .eq("id", ctx.organization.id)
        .maybeSingle();
      const validityDays = Number((orgRow as { quote_validity_days?: number } | null)?.quote_validity_days ?? 30);
      const qToken = generateQuoteToken();
      const { error: qErr } = await admin
        .from("quotes")
        .update({
          status: "pending",
          token_hash: hashQuoteToken(qToken),
          link_token_encrypted: encryptLinkToken(qToken),
          slug: generateQuoteSlug(),
          expires_at: new Date(Date.now() + validityDays * 24 * 60 * 60 * 1000).toISOString(),
          sent_at: new Date().toISOString(),
          sent_channels: ["health_check_report"],
        })
        .eq("id", quoteId)
        .eq("status", "draft");
      if (qErr) return { error: `Could not activate the quote: ${qErr.message}` };
    }
  }

  // Mint (or re-mint) the report link and mark sent.
  const token = generateCheckToken();
  const slug = generateCheckSlug();
  const { error: sendErr } = await admin
    .from("inspections")
    .update({
      token_hash: hashCheckToken(token),
      slug,
      status: "sent",
      sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", inspectionId);
  if (sendErr) return { error: sendErr.message };

  const url = tenantCheckUrl(ctx.organization.slug, slug, token);
  const { data: locRow } = await admin.from("locations").select("address").eq("id", ctx.location.id).maybeSingle();
  const identity = {
    orgName: ctx.organization.name,
    locationName: ctx.location.name,
    address: (locRow as { address: string | null } | null)?.address ?? null,
  };
  const label = garageLabel(identity);
  const firstName = customer.full_name?.split(" ")[0] ?? "there";
  const reg = job?.vehicle?.registration ?? "your vehicle";
  const vehicleDesc = vehicleLine(job?.vehicle ?? null) || reg;
  const findingsLine =
    red + amber > 0
      ? `${red > 0 ? `${red} item${red === 1 ? "" : "s"} need${red === 1 ? "s" : ""} urgent attention` : ""}${red > 0 && amber > 0 ? " and " : ""}${amber > 0 ? `${amber} advisor${amber === 1 ? "y" : "ies"} to keep an eye on` : ""}.`
      : "Everything we checked is in good order.";

  const channels: string[] = [];

  if (customer.email) {
    const result = await sendEmail({
      to: customer.email,
      subject: `Vehicle health check for ${reg} — ${label}`,
      text: `Hi ${firstName},\n\nWe've completed a ${green + red + amber}-point vehicle health check on ${vehicleDesc}. ${findingsLine}\n\nOpen the report to see each item with photos${quoteId ? ", and approve or decline the recommended work item by item" : ""}.\n\n${garageLocationBlock(identity)}`,
      cta: { url, label: "View health check report" },
    });
    if (result.success) channels.push("email");
  }
  if (customer.phone && opts?.sms !== false) {
    const result = await sendSms({
      to: customer.phone,
      body: `Hi ${firstName}, ${label} completed a health check on ${reg}: ${red} urgent, ${amber} advisory. Report${quoteId ? " + approval" : ""}: ${url} — ${garageLocationInline(identity)}`,
    });
    if (result.success) channels.push("sms");
  }
  if (customer.phone && opts?.whatsapp) {
    const result = await sendWhatsApp({
      to: customer.phone,
      body: `Hi ${firstName}, ${label} has completed a vehicle health check on ${reg} — ${red} urgent, ${amber} advisory, ${green} OK. Full report with photos${quoteId ? " and approval" : ""}: ${url}\n${garageLocationInline(identity)}`,
    });
    if (result.success) channels.push("whatsapp");
  }

  if (channels.length === 0) {
    // Roll back so the check can be re-sent cleanly.
    await admin
      .from("inspections")
      .update({ token_hash: null, slug: null, status: "complete", sent_at: null })
      .eq("id", inspectionId);
    return { error: "Failed to send via any channel." };
  }

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "inspection.send",
    entityType: "inspection",
    entityId: inspectionId,
    metadata: { job_id: inspection.job_id, channels, red, amber, green, quote_id: quoteId },
  });

  revalidatePath(`/staff/jobs/${inspection.job_id}`);
  return { success: true, url, channels };
}
