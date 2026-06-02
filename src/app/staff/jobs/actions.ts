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
import { durationMinutes } from "@/lib/time-tracking";

export type LabourEstimateResult = { error: string } | { hours: number; note: string };

export type ClockResult = { error: string } | { success: true };

// Clock the current staff member onto a job. One open entry per user — they
// must clock out of any current job first. Any location member can track time.
export async function clockIn(jobId: string): Promise<ClockResult> {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  const { data: job } = await admin
    .from("jobs")
    .select("id, location_id")
    .eq("id", jobId)
    .maybeSingle();
  if (!job || job.location_id !== ctx.location.id) return { error: "Job not found." };

  const { data: openRows } = await admin
    .from("job_time_entries")
    .select("id")
    .eq("user_id", ctx.user.id)
    .is("ended_at", null)
    .limit(1);
  if (openRows && openRows.length > 0) {
    return { error: "You're already clocked in. Clock out of your current job first." };
  }

  const nowIso = new Date().toISOString();
  const { error } = await admin.from("job_time_entries").insert({
    job_id: jobId,
    location_id: ctx.location.id,
    user_id: ctx.user.id,
    status: "running",
    active_minutes: 0,
    started_at: nowIso,
    segment_started_at: nowIso,
  });
  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "job.clock_in",
    entityType: "job",
    entityId: jobId,
  });

  revalidatePath(`/staff/jobs/${jobId}`);
  return { success: true };
}

const TIME_ENTRY_SELECT =
  "id, job_id, user_id, location_id, started_at, ended_at, status, active_minutes, segment_started_at";

type TimeEntryRow = {
  id: string;
  job_id: string;
  user_id: string;
  location_id: string;
  started_at: string;
  ended_at: string | null;
  status: string;
  active_minutes: number;
  segment_started_at: string | null;
};

// Owner-only fetch of a time entry scoped to the caller's location.
async function loadOwnEntry(
  entryId: string,
  ctx: Awaited<ReturnType<typeof requireStaffContext>>,
): Promise<TimeEntryRow | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("job_time_entries").select(TIME_ENTRY_SELECT).eq("id", entryId).maybeSingle();
  const entry = data as TimeEntryRow | null;
  if (!entry || entry.location_id !== ctx.location.id || entry.user_id !== ctx.user.id) return null;
  return entry;
}

// Pause: bank the current running segment, leave the entry open (paused) so
// idle time between pause and resume isn't counted.
export async function pauseClock(entryId: string): Promise<ClockResult> {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();
  const entry = await loadOwnEntry(entryId, ctx);
  if (!entry) return { error: "Time entry not found." };
  if (entry.status !== "running" || !entry.segment_started_at) return { error: "Not currently running." };

  const banked = entry.active_minutes + durationMinutes(entry.segment_started_at, new Date().toISOString());
  const { error } = await admin
    .from("job_time_entries")
    .update({ status: "paused", active_minutes: banked, segment_started_at: null })
    .eq("id", entryId);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "job.clock_pause",
    entityType: "job",
    entityId: entry.job_id,
    metadata: { entry_id: entryId, active_minutes: banked },
  });

  revalidatePath(`/staff/jobs/${entry.job_id}`);
  return { success: true };
}

// Resume a paused entry — start a new active segment.
export async function resumeClock(entryId: string): Promise<ClockResult> {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();
  const entry = await loadOwnEntry(entryId, ctx);
  if (!entry) return { error: "Time entry not found." };
  if (entry.status !== "paused") return { error: "Entry is not paused." };

  // Don't let a user run two clocks at once.
  const { data: openRows } = await admin
    .from("job_time_entries")
    .select("id")
    .eq("user_id", ctx.user.id)
    .eq("status", "running")
    .limit(1);
  if (openRows && openRows.length > 0) {
    return { error: "You're already running another clock. Pause or clock out of it first." };
  }

  const { error } = await admin
    .from("job_time_entries")
    .update({ status: "running", segment_started_at: new Date().toISOString() })
    .eq("id", entryId);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "job.clock_resume",
    entityType: "job",
    entityId: entry.job_id,
    metadata: { entry_id: entryId },
  });

  revalidatePath(`/staff/jobs/${entry.job_id}`);
  return { success: true };
}

// Clock out: bank any running segment, mark completed. Only the owner.
export async function clockOut(entryId: string): Promise<ClockResult> {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();
  const entry = await loadOwnEntry(entryId, ctx);
  if (!entry) return { error: "Time entry not found." };
  if (entry.status === "completed" || entry.ended_at) return { error: "Already clocked out." };

  const endedAt = new Date().toISOString();
  const finalSegment =
    entry.status === "running" && entry.segment_started_at
      ? durationMinutes(entry.segment_started_at, endedAt)
      : 0;
  const total = entry.active_minutes + finalSegment;

  const { error } = await admin
    .from("job_time_entries")
    .update({ status: "completed", ended_at: endedAt, duration_minutes: total, active_minutes: total, segment_started_at: null })
    .eq("id", entryId);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "job.clock_out",
    entityType: "job",
    entityId: entry.job_id,
    metadata: { entry_id: entryId, duration_minutes: total },
  });

  revalidatePath(`/staff/jobs/${entry.job_id}`);
  return { success: true };
}

// Manual duration override (whole minutes). Fixes inflated entries — a
// forgotten punch-out, or on-call elapsed time that wasn't active work. The
// entry owner OR an org owner/admin may adjust; bounded to a sane range.
const MAX_ENTRY_MINUTES = 24 * 60;

export async function adjustEntryDuration(entryId: string, minutes: number): Promise<ClockResult> {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  if (!Number.isFinite(minutes) || minutes < 0 || minutes > MAX_ENTRY_MINUTES) {
    return { error: `Enter a duration between 0 and ${MAX_ENTRY_MINUTES} minutes.` };
  }
  const mins = Math.round(minutes);

  const { data } = await admin.from("job_time_entries").select(TIME_ENTRY_SELECT).eq("id", entryId).maybeSingle();
  const entry = data as TimeEntryRow | null;
  if (!entry || entry.location_id !== ctx.location.id) return { error: "Time entry not found." };

  const isOwner = entry.user_id === ctx.user.id;
  const isManager = ctx.orgRole === "owner" || ctx.orgRole === "admin";
  if (!isOwner && !isManager) return { error: "You can only adjust your own time." };

  const { error } = await admin
    .from("job_time_entries")
    .update({
      status: "completed",
      duration_minutes: mins,
      active_minutes: mins,
      segment_started_at: null,
      ended_at: entry.ended_at ?? new Date().toISOString(),
    })
    .eq("id", entryId);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "job.time_adjust",
    entityType: "job",
    entityId: entry.job_id,
    metadata: { entry_id: entryId, minutes: mins, target_user_id: entry.user_id },
  });

  revalidatePath(`/staff/jobs/${entry.job_id}`);
  return { success: true };
}

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
