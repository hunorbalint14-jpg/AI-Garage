"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";

export type JobItemType = "part" | "labour" | "other";
export type JobStatus = "open" | "complete" | "invoiced";

export type AddJobItemResult = { error: string } | { success: true; itemId: string };

export async function addJobItem(jobId: string, formData: FormData): Promise<AddJobItemResult> {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  const description = (formData.get("description") as string | null)?.trim();
  const type = (formData.get("type") as string | null)?.trim() || "part";
  const quantityStr = (formData.get("quantity") as string | null)?.trim();
  const unitPriceStr = (formData.get("unitPrice") as string | null)?.trim();

  if (!description) return { error: "Description is required." };
  if (!["part", "labour", "other"].includes(type)) return { error: "Invalid item type." };

  const quantity = parseFloat(quantityStr || "1");
  const unitPrice = parseFloat(unitPriceStr || "0");

  if (Number.isNaN(quantity) || quantity <= 0) return { error: "Quantity must be greater than 0." };
  if (Number.isNaN(unitPrice) || unitPrice < 0) return { error: "Unit price must be 0 or greater." };

  const { data: job } = await admin
    .from("jobs")
    .select("id, location_id, status")
    .eq("id", jobId)
    .maybeSingle();

  if (!job || job.location_id !== ctx.location.id) return { error: "Job not found." };
  if (job.status !== "open") return { error: "Cannot add items to a completed job." };

  const { data, error } = await admin
    .from("job_items")
    .insert({ job_id: jobId, description, type, quantity, unit_price: unitPrice })
    .select("id")
    .single();

  if (error) return { error: error.message };

  revalidatePath(`/staff/jobs/${jobId}`);
  return { success: true, itemId: data.id };
}

export type RemoveJobItemResult = { error: string } | { success: true };

export async function removeJobItem(jobId: string, itemId: string): Promise<RemoveJobItemResult> {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  const { data: job } = await admin.from("jobs").select("location_id, status").eq("id", jobId).maybeSingle();
  if (!job || job.location_id !== ctx.location.id) return { error: "Job not found." };
  if (job.status !== "open") return { error: "Cannot modify a completed job." };

  const { error } = await admin.from("job_items").delete().eq("id", itemId).eq("job_id", jobId);
  if (error) return { error: error.message };

  revalidatePath(`/staff/jobs/${jobId}`);
  return { success: true };
}

export type UpdateJobResult = { error: string } | { success: true };

export async function updateJob(jobId: string, formData: FormData): Promise<UpdateJobResult> {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  const description = (formData.get("description") as string | null)?.trim() || null;
  const notes = (formData.get("notes") as string | null)?.trim() || null;

  const { data: job } = await admin.from("jobs").select("location_id, status").eq("id", jobId).maybeSingle();
  if (!job || job.location_id !== ctx.location.id) return { error: "Job not found." };

  const { error } = await admin.from("jobs").update({ description, notes }).eq("id", jobId);
  if (error) return { error: error.message };

  revalidatePath(`/staff/jobs/${jobId}`);
  return { success: true };
}

export async function completeJob(jobId: string): Promise<UpdateJobResult> {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  const { data: job } = await admin
    .from("jobs")
    .select("id, location_id, booking_id, status")
    .eq("id", jobId)
    .maybeSingle();

  if (!job || job.location_id !== ctx.location.id) return { error: "Job not found." };
  if (job.status === "complete" || job.status === "invoiced") return { error: "Job already complete." };

  const completedAt = new Date().toISOString();

  const { error } = await admin
    .from("jobs")
    .update({ status: "complete", completed_at: completedAt })
    .eq("id", jobId);

  if (error) return { error: error.message };

  // Mark linked booking as complete
  if (job.booking_id) {
    await admin.from("bookings").update({ status: "complete" }).eq("id", job.booking_id);
  }

  revalidatePath(`/staff/jobs/${jobId}`);
  revalidatePath("/staff/bookings");
  return { success: true };
}

export async function reopenJob(jobId: string): Promise<UpdateJobResult> {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  const { data: job } = await admin
    .from("jobs")
    .select("id, location_id, booking_id, status")
    .eq("id", jobId)
    .maybeSingle();

  if (!job || job.location_id !== ctx.location.id) return { error: "Job not found." };
  if (job.status === "invoiced") return { error: "Cannot reopen an invoiced job." };

  const { error } = await admin
    .from("jobs")
    .update({ status: "open", completed_at: null })
    .eq("id", jobId);

  if (error) return { error: error.message };

  if (job.booking_id) {
    await admin.from("bookings").update({ status: "in_progress" }).eq("id", job.booking_id);
  }

  revalidatePath(`/staff/jobs/${jobId}`);
  revalidatePath("/staff/bookings");
  return { success: true };
}

export async function deleteJob(jobId: string): Promise<UpdateJobResult> {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  const { data: job } = await admin
    .from("jobs")
    .select("id, location_id, booking_id, status")
    .eq("id", jobId)
    .maybeSingle();

  if (!job || job.location_id !== ctx.location.id) return { error: "Job not found." };
  if (job.status === "invoiced") return { error: "Cannot delete an invoiced job." };

  const { error } = await admin.from("jobs").delete().eq("id", jobId);
  if (error) return { error: error.message };

  if (job.booking_id) {
    await admin.from("bookings").update({ status: "scheduled" }).eq("id", job.booking_id);
  }

  redirect("/staff/bookings");
}
