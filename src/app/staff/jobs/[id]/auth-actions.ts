"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { hasPermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import {
  SIGNATURE_BUCKET,
  authorisedTotal,
  decodeSignatureDataUrl,
  latestAuthorisation,
  signaturePath,
  type AuthItemSnapshot,
} from "@/lib/work-auth";

// Counter-signature capture (#503 PR 2). The artefact snapshots the job's
// items and the org T&Cs AS SHOWN at signing — server-fetched here, not
// trusted from the client — plus the signature PNG. Rows are immutable to
// staff (insert/select RLS only).

export type CaptureSignatureResult =
  | { error: string }
  | { success: true; authId: string; total: number; kind: "initial" | "variation" };

export async function captureCounterSignature(
  jobId: string,
  args: { signatureDataUrl: string; signerName: string },
): Promise<CaptureSignatureResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "bookings")) return { error: "Permission denied." };
  const admin = createAdminClient();

  const { data: jobRow } = await admin
    .from("jobs")
    .select("id, location_id, status, customer_id, customer:customers(full_name)")
    .eq("id", jobId)
    .maybeSingle();
  const job = jobRow as unknown as {
    id: string;
    location_id: string;
    status: string;
    customer_id: string | null;
    customer: { full_name: string | null } | null;
  } | null;
  if (!job || job.location_id !== ctx.location.id) return { error: "Job not found." };
  if (job.status !== "open") return { error: "Only open jobs can be authorised." };

  const signature = decodeSignatureDataUrl(args.signatureDataUrl);
  if (!signature) return { error: "Signature didn't come through — please sign again." };

  // Authoritative snapshot: items + terms fetched here, at signing time.
  const { data: itemRows } = await admin
    .from("job_items")
    .select("description, type, quantity, unit_price, vat_rate")
    .eq("job_id", jobId)
    .order("created_at", { ascending: true });
  const items = (itemRows ?? []) as AuthItemSnapshot[];
  if (items.length === 0) return { error: "Add the estimate items before taking authorisation." };

  const { data: orgRow } = await admin
    .from("organizations")
    .select("authorisation_terms")
    .eq("id", ctx.organization.id)
    .maybeSingle();
  const terms = (orgRow as { authorisation_terms: string | null } | null)?.authorisation_terms ?? null;

  const existing = await latestAuthorisation(admin, jobId);
  const kind: "initial" | "variation" = existing ? "variation" : "initial";
  const total = authorisedTotal(items);
  const authId = crypto.randomUUID();
  const path = signaturePath(ctx.location.id, jobId, authId);

  const { error: uploadErr } = await admin.storage
    .from(SIGNATURE_BUCKET)
    .upload(path, signature, { contentType: "image/png" });
  if (uploadErr) return { error: `Could not store the signature: ${uploadErr.message}` };

  const { error: insertErr } = await admin.from("work_authorisations").insert({
    id: authId,
    location_id: ctx.location.id,
    job_id: jobId,
    customer_id: job.customer_id,
    kind,
    method: "counter_signature",
    status: "authorised",
    authorised_total: total,
    items_snapshot: items,
    terms_snapshot: terms,
    signature_path: path,
    signed_name: args.signerName.trim().slice(0, 120) || job.customer?.full_name || null,
    authorised_at: new Date().toISOString(),
    created_by: ctx.user.id,
  });
  if (insertErr) {
    await admin.storage.from(SIGNATURE_BUCKET).remove([path]);
    return { error: insertErr.message };
  }

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "authorisation.captured",
    entityType: "work_authorisation",
    entityId: authId,
    metadata: { job_id: jobId, total, kind, method: "counter_signature", items: items.length },
  });

  revalidatePath(`/staff/jobs/${jobId}`);
  return { success: true, authId, total, kind };
}
