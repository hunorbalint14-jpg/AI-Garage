"use server";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyReauthAccess } from "@/lib/work-auth";
import { logAudit } from "@/lib/audit";
import { createStaffNotification } from "@/lib/staff-notifications";

// Re-authorisation response (#503 PR 4). Token-gated, no login. Approving
// flips the PENDING artefact to authorised with the identity trail;
// declining records the reason and alerts staff immediately — they're
// mid-job waiting on this answer.

export type ReauthRespondResult = { error: string } | { success: true; approved: boolean };

async function requesterIdentity(): Promise<{ ip: string | null; userAgent: string | null }> {
  try {
    const h = await headers();
    const fwd = h.get("x-forwarded-for");
    return { ip: fwd ? fwd.split(",")[0].trim() : null, userAgent: h.get("user-agent") };
  } catch {
    return { ip: null, userAgent: null };
  }
}

export async function respondToReauth(
  slug: string,
  token: string,
  response: { approve: true; signedName: string } | { approve: false; reason: string | null },
): Promise<ReauthRespondResult> {
  const verify = await verifyReauthAccess(slug, token);
  if (!verify.ok) {
    if (verify.reason === "responded") return { error: "This request has already been answered — thank you!" };
    return { error: "This link is invalid or has expired. Contact the garage." };
  }
  const auth = verify.auth;
  const admin = createAdminClient();
  const identity = await requesterIdentity();
  const nowIso = new Date().toISOString();

  const approving = response.approve;
  const signedName = approving ? response.signedName.trim().slice(0, 120) : null;
  if (approving && !signedName) return { error: "Please type your name to authorise the work." };
  const reason = !approving ? (response.reason?.trim().slice(0, 500) || null) : null;

  // Atomic single-use claim: only the still-pending row flips.
  const { data: claimed, error } = await admin
    .from("work_authorisations")
    .update({
      status: approving ? "authorised" : "declined",
      signed_name: signedName,
      declined_reason: reason,
      ip: identity.ip,
      user_agent: identity.userAgent?.slice(0, 300) ?? null,
      authorised_at: approving ? nowIso : null,
      updated_at: nowIso,
    })
    .eq("id", auth.id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!claimed) return { error: "This request has already been answered — thank you!" };

  await logAudit({
    organizationId: auth.organization_id,
    action: "authorisation.reauth_responded",
    entityType: "work_authorisation",
    entityId: auth.id,
    metadata: { job_id: auth.job_id, approved: approving, total: auth.authorised_total, reason },
  });

  const fmt = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(auth.authorised_total);
  void createStaffNotification({
    userId: null,
    locationId: auth.location_id,
    organizationId: auth.organization_id,
    kind: approving ? "authorisation.approved" : "authorisation.declined",
    title: approving ? `✓ Re-authorisation approved (${fmt})` : `✗ Re-authorisation DECLINED (${fmt})`,
    body: approving
      ? "The customer approved the updated total — continue the work."
      : reason
        ? `“${reason.slice(0, 140)}” — call them before doing the extra work.`
        : "The customer declined the increase — call them before doing the extra work.",
    href: auth.job_id ? `/staff/jobs/${auth.job_id}` : "/staff/jobs",
    entityType: "work_authorisation",
    entityId: auth.id,
  });

  return { success: true, approved: approving };
}
