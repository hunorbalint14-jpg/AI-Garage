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
  generateReauthToken,
  generateReauthSlug,
  hashReauthToken,
  tenantReauthUrl,
  type AuthItemSnapshot,
} from "@/lib/work-auth";
import { sendEmail } from "@/lib/email";
import { sendSms } from "@/lib/sms";
import { garageLabel, garageLocationBlock, garageLocationInline } from "@/lib/garage-identity";

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

// ── One-tap re-authorisation request (#503 PR 4) ───────────────────────────
// Work grew past what was authorised: snapshot the CURRENT items/total/terms
// into a PENDING artefact, mint a token, and message the customer with the
// new total and the delta. Approving on /authorise/[slug] flips it
// authorised; a new request supersedes any older pending one.

export type RequestReauthResult =
  | { error: string }
  | { success: true; url: string; channels: string[]; total: number };

export async function requestReauthorisation(jobId: string): Promise<RequestReauthResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "quotes_send")) return { error: "Permission denied." };
  const admin = createAdminClient();

  const { data: jobRow } = await admin
    .from("jobs")
    .select(
      "id, location_id, status, customer_id, customer:customers(full_name, email, phone), vehicle:vehicles(registration)",
    )
    .eq("id", jobId)
    .maybeSingle();
  const job = jobRow as unknown as {
    id: string;
    location_id: string;
    status: string;
    customer_id: string | null;
    customer: { full_name: string | null; email: string | null; phone: string | null } | null;
    vehicle: { registration: string | null } | null;
  } | null;
  if (!job || job.location_id !== ctx.location.id) return { error: "Job not found." };
  if (job.status !== "open") return { error: "Only open jobs can be re-authorised." };
  if (!job.customer?.email && !job.customer?.phone) {
    return { error: "Customer has no email or phone — take a counter signature instead." };
  }

  const { data: itemRows } = await admin
    .from("job_items")
    .select("description, type, quantity, unit_price, vat_rate")
    .eq("job_id", jobId)
    .order("created_at", { ascending: true });
  const items = (itemRows ?? []) as AuthItemSnapshot[];
  if (items.length === 0) return { error: "The job has no items to authorise." };
  const total = authorisedTotal(items);

  const previous = await latestAuthorisation(admin, jobId);

  const { data: orgRow } = await admin
    .from("organizations")
    .select("authorisation_terms")
    .eq("id", ctx.organization.id)
    .maybeSingle();
  const terms = (orgRow as { authorisation_terms: string | null } | null)?.authorisation_terms ?? null;

  // Supersede any older pending request — one live link per job.
  await admin
    .from("work_authorisations")
    .update({ status: "declined", updated_at: new Date().toISOString() })
    .eq("job_id", jobId)
    .eq("status", "pending");

  const token = generateReauthToken();
  const slug = generateReauthSlug();
  const nowIso = new Date().toISOString();
  const { data: inserted, error: insertErr } = await admin
    .from("work_authorisations")
    .insert({
      location_id: ctx.location.id,
      job_id: jobId,
      customer_id: job.customer_id,
      kind: previous ? "variation" : "initial",
      method: "reauth_link",
      status: "pending",
      authorised_total: total,
      items_snapshot: items,
      terms_snapshot: terms,
      token_hash: hashReauthToken(token),
      slug,
      requested_at: nowIso,
      created_by: ctx.user.id,
    })
    .select("id")
    .single();
  if (insertErr || !inserted) return { error: insertErr?.message ?? "Could not create the request." };

  const url = tenantReauthUrl(ctx.organization.slug, slug, token);
  const { data: locRow } = await admin.from("locations").select("address").eq("id", ctx.location.id).maybeSingle();
  const identity = {
    orgName: ctx.organization.name,
    locationName: ctx.location.name,
    address: (locRow as { address: string | null } | null)?.address ?? null,
  };
  const label = garageLabel(identity);
  const firstName = job.customer?.full_name?.split(" ")[0] ?? "there";
  const reg = job.vehicle?.registration ?? "your vehicle";
  const fmt = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
  const deltaLine = previous
    ? `The work has grown from the ${fmt(Number(previous.authorised_total))} you authorised to ${fmt(total)} (${fmt(Math.round((total - Number(previous.authorised_total)) * 100) / 100)} more).`
    : `The total for the work is ${fmt(total)}.`;

  const channels: string[] = [];
  if (job.customer?.email) {
    const res = await sendEmail({
      to: job.customer.email,
      subject: `Please approve the updated total for ${reg} — ${label}`,
      text: `Hi ${firstName},\n\nWhile working on ${reg} we found the job needs more than first authorised. ${deltaLine}\n\nPlease review the itemised list and approve (or decline) before we continue — we won't carry out the extra work without your say-so.\n\n${garageLocationBlock(identity)}`,
      cta: { url, label: "Review & approve" },
    });
    if (res.success) channels.push("email");
  }
  if (job.customer?.phone) {
    const res = await sendSms({
      to: job.customer.phone,
      body: `Hi ${firstName}, ${label}: the work on ${reg} now totals ${fmt(total)}${previous ? ` (was ${fmt(Number(previous.authorised_total))})` : ""}. Approve or decline: ${url} — ${garageLocationInline(identity)}`,
    });
    if (res.success) channels.push("sms");
  }
  if (channels.length === 0) {
    // Nothing reached the customer — pull the pending request back.
    await admin.from("work_authorisations").delete().eq("id", (inserted as { id: string }).id);
    return { error: "Failed to send via any channel." };
  }

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "authorisation.reauth_requested",
    entityType: "work_authorisation",
    entityId: (inserted as { id: string }).id,
    metadata: { job_id: jobId, total, previous_total: previous ? Number(previous.authorised_total) : null, channels },
  });

  revalidatePath(`/staff/jobs/${jobId}`);
  return { success: true, url, channels, total };
}
