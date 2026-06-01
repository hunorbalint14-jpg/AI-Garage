"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { verifyReviewAccess } from "@/lib/review-links";
import { createStaffNotification } from "@/lib/staff-notifications";
import { logAudit } from "@/lib/audit";

export type SubmitReviewResult =
  | { error: string }
  | { ok: true; redirectTo?: string; lowScore?: boolean };

// Public, token-gated. Records the rating, marks the request responded
// (single-use), then routes: ≥4★ → the garage's Google review URL (if set);
// <4★ → captured privately + a staff notification, so a bad experience never
// lands on the public rating before the garage can respond.
export async function submitReview(
  token: string,
  score: number,
  feedback: string,
): Promise<SubmitReviewResult> {
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    return { error: "Please choose a rating from 1 to 5." };
  }

  const verify = await verifyReviewAccess(token);
  if (!verify.ok) {
    if (verify.reason === "already_responded") {
      return { error: "You've already left feedback for this visit — thank you!" };
    }
    return { error: "This feedback link is invalid or has expired." };
  }
  const review = verify.review;
  const admin = createAdminClient();
  const cleanFeedback = feedback?.trim().slice(0, 2000) || null;

  // Atomic single-use claim: only the still-'sent' row flips to 'responded'.
  const { data: claimed, error } = await admin
    .from("review_requests")
    .update({
      status: "responded",
      score,
      feedback_text: cleanFeedback,
      responded_at: new Date().toISOString(),
    })
    .eq("id", review.id)
    .eq("status", "sent")
    .select("id")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!claimed) return { error: "You've already left feedback for this visit — thank you!" };

  await logAudit({
    organizationId: review.organization_id,
    action: "review.submitted",
    entityType: "review_request",
    entityId: review.id,
    metadata: { score },
  });

  if (score < 4) {
    void createStaffNotification({
      userId: null,
      locationId: review.location_id,
      organizationId: review.organization_id,
      kind: "review.low_score",
      title: `${score}★ feedback needs attention`,
      body: cleanFeedback ? `“${cleanFeedback.slice(0, 140)}”` : `A customer left a ${score}-star rating.`,
      href: `/staff/jobs/${review.job_id}`,
      entityType: "review_request",
      entityId: review.id,
    });
    return { ok: true, lowScore: true };
  }

  // Happy customer → send them to Google (if the garage has configured a URL).
  const { data: org } = await admin
    .from("organizations")
    .select("google_review_url")
    .eq("id", review.organization_id ?? "")
    .maybeSingle();
  const url = (org as { google_review_url?: string | null } | null)?.google_review_url ?? null;
  return { ok: true, redirectTo: url ?? undefined };
}
