"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaffContext } from "@/lib/staff-context";
import { hasPermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { sendSms } from "@/lib/sms";
import { sendWhatsApp } from "@/lib/whatsapp";
import { estimateLabourTime } from "@/lib/ai-labour";
import { enforceRateLimit, tooManyAttemptsError } from "@/lib/rate-limit";
import { enqueueReviewRequest } from "@/lib/review-links";
import { listLocationStaff } from "@/lib/staff-directory";
import { logAudit } from "@/lib/audit";

export type LabourEstimateResult = { error: string } | { hours: number; note: string };

export type AssignTechnicianResult = { error: string } | { success: true };

export async function assignJobTechnician(
  jobId: string,
  userId: string | null,
): Promise<AssignTechnicianResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "bookings")) return { error: "Permission denied." };
  const admin = createAdminClient();

  if (userId) {
    const staff = await listLocationStaff(ctx.location.id, ctx.organization.id);
    if (!staff.some((s) => s.id === userId)) {
      return { error: "Staff member not found at this location." };
    }
  }

  const { error } = await admin
    .from("jobs")
    .update({ assigned_to: userId })
    .eq("id", jobId)
    .eq("location_id", ctx.location.id);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "job.assign",
    entityType: "job",
    entityId: jobId,
    metadata: { assigned_to: userId },
  });

  revalidatePath(`/staff/jobs/${jobId}`);
  revalidatePath("/staff");
  return { success: true };
}

export async function suggestLabourTime(
  description: string,
  vehicleDescription?: string,
): Promise<LabourEstimateResult> {
  const ctx = await requireStaffContext();
  if (!description.trim()) return { error: "Description required." };
  const limited = await enforceRateLimit("ai", ctx.user.id);
  if (!limited.ok) return tooManyAttemptsError(limited.retryAfter);
  try {
    return await estimateLabourTime(description.trim(), vehicleDescription);
  } catch {
    return { error: "Could not estimate — try a more specific description." };
  }
}

export type JobItemType = "part" | "labour" | "other";
export type JobStatus = "open" | "complete" | "invoiced";

export type AddJobItemResult = { error: string } | { success: true; itemId: string };

export async function addJobItem(jobId: string, formData: FormData): Promise<AddJobItemResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "bookings")) return { error: "Permission denied." };
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
  if (!hasPermission(ctx, "bookings")) return { error: "Permission denied." };
  const admin = createAdminClient();

  const { data: job } = await admin.from("jobs").select("location_id, status").eq("id", jobId).maybeSingle();
  if (!job || job.location_id !== ctx.location.id) return { error: "Job not found." };
  if (job.status !== "open") return { error: "Cannot modify a completed job." };

  const { error } = await admin.from("job_items").delete().eq("id", itemId).eq("job_id", jobId);
  if (error) return { error: error.message };

  revalidatePath(`/staff/jobs/${jobId}`);
  return { success: true };
}

export type UpdateJobItemResult = { error: string } | { success: true };

export async function updateJobItem(
  jobId: string,
  itemId: string,
  quantity: number,
  unitPrice: number,
): Promise<UpdateJobItemResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "bookings")) return { error: "Permission denied." };
  const admin = createAdminClient();

  if (!Number.isFinite(quantity) || quantity <= 0) return { error: "Quantity must be greater than 0." };
  if (!Number.isFinite(unitPrice) || unitPrice < 0) return { error: "Unit price must be 0 or greater." };

  const { data: job } = await admin.from("jobs").select("location_id, status").eq("id", jobId).maybeSingle();
  if (!job || job.location_id !== ctx.location.id) return { error: "Job not found." };
  if (job.status !== "open") return { error: "Cannot modify a completed job." };

  const { error } = await admin
    .from("job_items")
    .update({ quantity, unit_price: unitPrice })
    .eq("id", itemId)
    .eq("job_id", jobId);
  if (error) return { error: error.message };

  revalidatePath(`/staff/jobs/${jobId}`);
  return { success: true };
}

export type UpdateJobResult = { error: string } | { success: true };

export async function updateJob(jobId: string, formData: FormData): Promise<UpdateJobResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "bookings")) return { error: "Permission denied." };
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
  if (!hasPermission(ctx, "bookings")) return { error: "Permission denied." };
  const admin = createAdminClient();

  const { data: job } = await admin
    .from("jobs")
    .select("id, location_id, booking_id, status, customer_id, customer:customers(email)")
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

  // Queue a post-job review request (emailed next morning by the
  // review_requests cron). Fire-and-forget — never blocks completion.
  const jobRow = job as unknown as { customer_id: string | null; customer: { email: string | null } | null };
  void enqueueReviewRequest({
    jobId,
    locationId: ctx.location.id,
    organizationId: ctx.organization.id,
    customerId: jobRow.customer_id,
    customerEmail: jobRow.customer?.email ?? null,
  });

  revalidatePath(`/staff/jobs/${jobId}`);
  revalidatePath("/staff/bookings");
  revalidatePath("/staff/revenue");
  revalidatePath("/staff");
  return { success: true };
}

export async function reopenJob(jobId: string): Promise<UpdateJobResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "bookings")) return { error: "Permission denied." };
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

export type SendReviewRequestResult = { error: string } | { success: true; channels: string[] };

export async function sendReviewRequest(jobId: string): Promise<SendReviewRequestResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "reminders")) return { error: "Permission denied." };
  const admin = createAdminClient();

  const [jobRes, orgRes] = await Promise.all([
    admin.from("jobs").select("id, location_id, customer_id, status").eq("id", jobId).maybeSingle(),
    admin.from("organizations").select("name, phone, google_review_url").eq("id", ctx.organization.id).maybeSingle(),
  ]);

  const job = jobRes.data as { id: string; location_id: string; customer_id: string | null; status: string } | null;
  if (!job || job.location_id !== ctx.location.id) return { error: "Job not found." };
  if (job.status === "open") return { error: "Complete the job before requesting a review." };
  if (!job.customer_id) return { error: "No customer linked to this job." };

  const org = orgRes.data as { name: string; phone: string | null; google_review_url: string | null } | null;
  const reviewUrl = org?.google_review_url;
  if (!reviewUrl) return { error: "No Google review URL configured. Add it in Settings." };

  const { data: customer } = await admin
    .from("customers")
    .select("full_name, email, phone")
    .eq("id", job.customer_id)
    .maybeSingle();

  if (!customer) return { error: "Customer not found." };
  if (!customer.email && !customer.phone) return { error: "Customer has no email or phone." };

  const garageName = org?.name ?? ctx.organization.name;
  const firstName = customer.full_name?.split(" ")[0] ?? "there";

  const emailText = `Hi ${firstName},

Thank you for your recent visit to ${garageName}. We hope you're happy with the service!

If you have a moment, we'd really appreciate a Google review — it helps us a lot:

${reviewUrl}

Thanks again,
${garageName}`;

  const smsText = `Hi ${firstName}, thanks for visiting ${garageName}! We'd love a quick Google review: ${reviewUrl}`;

  const sentChannels: string[] = [];

  if (customer.email) {
    const result = await sendEmail({
      to: customer.email,
      subject: `How was your visit to ${garageName}?`,
      text: emailText,
    });
    sentChannels.push(result.success ? "email" : `email failed: ${result.error}`);
  }

  if (customer.phone) {
    const smsResult = await sendSms({ to: customer.phone, body: smsText });
    sentChannels.push(smsResult.success ? "SMS" : `SMS failed: ${smsResult.error}`);
    const waResult = await sendWhatsApp({ to: customer.phone, body: smsText });
    sentChannels.push(waResult.success ? "WhatsApp" : `WhatsApp failed: ${waResult.error}`);
  }

  const allFailed = sentChannels.every((c) => c.includes("failed"));
  if (allFailed) return { error: sentChannels.join("; ") };

  return { success: true, channels: sentChannels.filter((c) => !c.includes("failed")) };
}

export async function deleteJob(jobId: string): Promise<UpdateJobResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "bookings")) return { error: "Permission denied." };
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
