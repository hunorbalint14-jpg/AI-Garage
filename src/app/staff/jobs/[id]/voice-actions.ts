"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { hasPermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { structureVoiceNotes, type StructuredJob } from "@/lib/ai-job-from-voice";
import { enforceRateLimit, tooManyAttemptsError } from "@/lib/rate-limit";

export type StructureResult = { error: string } | { success: true; data: StructuredJob };

export async function structureTranscript(
  jobId: string,
  transcript: string,
): Promise<StructureResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "bookings")) return { error: "Permission denied." };
  if (!transcript?.trim()) return { error: "Transcript is empty." };
  if (transcript.length > 8000) return { error: "Transcript too long (max 8000 chars)." };

  const limited = await enforceRateLimit("ai", ctx.user.id);
  if (!limited.ok) return tooManyAttemptsError(limited.retryAfter);

  const admin = createAdminClient();
  const { data: job } = await admin
    .from("jobs")
    .select("id, location_id, vehicle:vehicles(make, model, year, registration)")
    .eq("id", jobId)
    .maybeSingle();

  type JobRow = {
    id: string;
    location_id: string;
    vehicle: { make: string | null; model: string | null; year: number | null; registration: string | null } | null;
  };

  const j = job as JobRow | null;
  if (!j || j.location_id !== ctx.location.id) return { error: "Job not found." };

  const vehicleDesc = j.vehicle
    ? [j.vehicle.year, j.vehicle.make, j.vehicle.model].filter(Boolean).join(" ") || j.vehicle.registration || undefined
    : undefined;

  try {
    const data = await structureVoiceNotes(transcript, vehicleDesc ?? undefined);
    return { success: true, data };
  } catch (e) {
    return { error: `AI failed: ${(e as Error).message}` };
  }
}

export type ApplyResult = { error: string } | { success: true; itemsAdded: number };

export async function applyStructuredJob(
  jobId: string,
  data: StructuredJob,
  appendToNotes: boolean,
): Promise<ApplyResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "bookings")) return { error: "Permission denied." };
  const admin = createAdminClient();

  const { data: job } = await admin
    .from("jobs")
    .select("id, location_id, notes, status")
    .eq("id", jobId)
    .maybeSingle();

  type JobRow = { id: string; location_id: string; notes: string | null; status: string };
  const j = job as JobRow | null;

  if (!j || j.location_id !== ctx.location.id) return { error: "Job not found." };
  if (j.status !== "open") return { error: "Cannot modify a closed job." };

  if (appendToNotes && data.summary) {
    const next = j.notes ? `${j.notes}\n\n${data.summary}` : data.summary;
    await admin.from("jobs").update({ notes: next }).eq("id", jobId);
  }

  // Pre-load the location's active product catalogue so we can match
  // voice-transcribed items against existing SKUs and pull the
  // canonical name + price instead of saving raw transcript text.
  const { data: productRows } = await admin
    .from("products")
    .select("id, name, sku, unit_price")
    .eq("location_id", j.location_id)
    .eq("active", true);
  type ProductRow = { id: string; name: string; sku: string | null; unit_price: number };
  const products = (productRows ?? []) as ProductRow[];

  // Case-insensitive substring match — find the longest product name
  // that appears in the transcribed item description. Picks "brake
  // pads" over "pads" when both exist.
  function matchProduct(desc: string): ProductRow | null {
    const hay = desc.toLowerCase();
    let best: ProductRow | null = null;
    for (const p of products) {
      const needle = p.name.toLowerCase();
      if (!needle) continue;
      if (hay.includes(needle) || needle.includes(hay)) {
        if (!best || p.name.length > best.name.length) best = p;
      }
    }
    return best;
  }

  let added = 0;
  for (const item of data.items) {
    const matched = item.type === "part" ? matchProduct(item.description) : null;
    const description = matched ? matched.name : item.description;
    const unitPrice = matched ? Number(matched.unit_price) : 0;
    const { error } = await admin.from("job_items").insert({
      job_id: jobId,
      description,
      type: item.type,
      quantity: item.quantity,
      unit_price: unitPrice,
    });
    if (!error) added++;
  }

  revalidatePath(`/staff/jobs/${jobId}`);
  return { success: true, itemsAdded: added };
}
