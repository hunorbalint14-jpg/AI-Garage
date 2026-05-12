"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { structureVoiceNotes, type StructuredJob } from "@/lib/ai-job-from-voice";

export type StructureResult = { error: string } | { success: true; data: StructuredJob };

export async function structureTranscript(
  jobId: string,
  transcript: string,
): Promise<StructureResult> {
  const ctx = await requireStaffContext();
  if (!transcript?.trim()) return { error: "Transcript is empty." };
  if (transcript.length > 8000) return { error: "Transcript too long (max 8000 chars)." };

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

  let added = 0;
  for (const item of data.items) {
    const { error } = await admin.from("job_items").insert({
      job_id: jobId,
      description: item.description,
      type: item.type,
      quantity: item.quantity,
      unit_price: 0,
    });
    if (!error) added++;
  }

  revalidatePath(`/staff/jobs/${jobId}`);
  return { success: true, itemsAdded: added };
}
