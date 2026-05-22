"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { logAudit } from "@/lib/audit";
import { verifyQuoteAccess } from "@/lib/quote-links";

export type ApproveResult = { error: string } | { success: true };

// Notify the mechanic who raised the quote (and fallback to all location staff
// if the original mechanic doesn't have an email on record).
async function notifyStaffOfDecision(args: {
  quoteId: string;
  jobId: string;
  locationId: string;
  decision: "approved" | "declined";
  declineReason: string | null;
  total: number;
  vehicleReg: string | null;
  customerName: string | null;
  createdBy: string | null;
}) {
  const admin = createAdminClient();
  const recipients = new Set<string>();

  if (args.createdBy) {
    const { data: actor } = await admin.auth.admin.getUserById(args.createdBy);
    if (actor?.user?.email) recipients.add(actor.user.email);
  }

  // Also email every location member as a fallback.
  const { data: locMembers } = await admin
    .from("location_users")
    .select("user_id")
    .eq("location_id", args.locationId);
  for (const m of locMembers ?? []) {
    const { data: u } = await admin.auth.admin.getUserById((m as { user_id: string }).user_id);
    if (u?.user?.email) recipients.add(u.user.email);
  }

  const totalFmt = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(args.total);
  const who = args.customerName ?? "Customer";
  const reg = args.vehicleReg ?? "the vehicle";

  const subject = args.decision === "approved"
    ? `✓ Quote approved by ${who} (${reg})`
    : `✗ Quote declined by ${who} (${reg})`;

  const text = args.decision === "approved"
    ? `${who} approved the additional-work quote on ${reg} (${totalFmt}). The items have been added to the job — continue the work.`
    : `${who} declined the additional-work quote on ${reg} (${totalFmt}).${args.declineReason ? `\n\nReason: ${args.declineReason}` : ""}\n\nContinue with the original booking scope only.`;

  for (const email of recipients) {
    await sendEmail({ to: email, subject, text });
  }
}

export async function approveQuote(slug: string, token: string): Promise<ApproveResult> {
  const verify = await verifyQuoteAccess(slug, token, ["pending"]);
  if (!verify.ok) {
    if (verify.reason === "wrong_status") return { error: "This quote has already been responded to." };
    if (verify.reason === "expired") return { error: "This quote has expired." };
    return { error: "Invalid link." };
  }

  const admin = createAdminClient();

  // Atomic status transition — only the row still `pending` flips, so two
  // concurrent approvals can't both insert items.
  const { data: claimed, error: claimErr } = await admin
    .from("job_quotes")
    .update({ status: "approved", responded_at: new Date().toISOString() })
    .eq("id", verify.quote.id)
    .eq("status", "pending")
    .select("id, job_id, location_id, total, created_by")
    .maybeSingle();
  if (claimErr) return { error: claimErr.message };
  if (!claimed) return { error: "This quote has already been responded to." };

  type Claimed = { id: string; job_id: string; location_id: string; total: number; created_by: string | null };
  const q = claimed as Claimed;

  // Check the parent job is still open. If not, mark the quote as
  // approved_after_close and leave items alone — staff will need to reopen.
  const { data: job } = await admin
    .from("jobs")
    .select("id, status, customer:customers(full_name), vehicle:vehicles(registration)")
    .eq("id", q.job_id)
    .maybeSingle();

  type JobRow = {
    id: string;
    status: string;
    customer: { full_name: string | null } | null;
    vehicle: { registration: string | null } | null;
  };
  const jobRow = job as JobRow | null;

  if (!jobRow || jobRow.status !== "open") {
    await admin
      .from("job_quotes")
      .update({ status: "approved_after_close" })
      .eq("id", q.id);

    await logAudit({
      action: "quote.approve",
      entityType: "job_quote",
      entityId: q.id,
      metadata: { job_id: q.job_id, total: q.total, after_close: true },
    });

    void notifyStaffOfDecision({
      quoteId: q.id,
      jobId: q.job_id,
      locationId: q.location_id,
      decision: "approved",
      declineReason: null,
      total: q.total,
      vehicleReg: jobRow?.vehicle?.registration ?? null,
      customerName: jobRow?.customer?.full_name ?? null,
      createdBy: q.created_by,
    });

    return { success: true };
  }

  // Copy snapshot items into job_items.
  const { data: snapshot } = await admin
    .from("job_quote_items")
    .select("description, type, quantity, unit_price")
    .eq("quote_id", q.id)
    .order("sort_order");

  const itemsToInsert = (snapshot ?? []).map((it) => ({
    job_id: q.job_id,
    description: (it as { description: string }).description,
    type: (it as { type: string }).type,
    quantity: (it as { quantity: number }).quantity,
    unit_price: (it as { unit_price: number }).unit_price,
  }));

  let appliedIds: string[] = [];
  if (itemsToInsert.length > 0) {
    const { data: inserted, error: insertErr } = await admin
      .from("job_items")
      .insert(itemsToInsert)
      .select("id");
    if (insertErr) {
      // Roll back — leave the quote pending so staff/customer can retry.
      await admin
        .from("job_quotes")
        .update({ status: "pending", responded_at: null })
        .eq("id", q.id);
      return { error: `Could not apply items: ${insertErr.message}` };
    }
    appliedIds = (inserted ?? []).map((r) => (r as { id: string }).id);
  }

  await admin
    .from("job_quotes")
    .update({ applied_job_item_ids: appliedIds })
    .eq("id", q.id);

  await logAudit({
    action: "quote.approve",
    entityType: "job_quote",
    entityId: q.id,
    metadata: { job_id: q.job_id, total: q.total, items_added: appliedIds.length },
  });

  void notifyStaffOfDecision({
    quoteId: q.id,
    jobId: q.job_id,
    locationId: q.location_id,
    decision: "approved",
    declineReason: null,
    total: q.total,
    vehicleReg: jobRow.vehicle?.registration ?? null,
    customerName: jobRow.customer?.full_name ?? null,
    createdBy: q.created_by,
  });

  return { success: true };
}

export type DeclineResult = { error: string } | { success: true };

export async function declineQuote(
  slug: string,
  token: string,
  reason: string | null,
): Promise<DeclineResult> {
  const verify = await verifyQuoteAccess(slug, token, ["pending"]);
  if (!verify.ok) {
    if (verify.reason === "wrong_status") return { error: "This quote has already been responded to." };
    if (verify.reason === "expired") return { error: "This quote has expired." };
    return { error: "Invalid link." };
  }

  const admin = createAdminClient();
  const cleanReason = reason?.trim().slice(0, 1000) || null;

  const { data: claimed, error: claimErr } = await admin
    .from("job_quotes")
    .update({
      status: "declined",
      responded_at: new Date().toISOString(),
      decline_reason: cleanReason,
    })
    .eq("id", verify.quote.id)
    .eq("status", "pending")
    .select("id, job_id, location_id, total, created_by")
    .maybeSingle();
  if (claimErr) return { error: claimErr.message };
  if (!claimed) return { error: "This quote has already been responded to." };

  type Claimed = { id: string; job_id: string; location_id: string; total: number; created_by: string | null };
  const q = claimed as Claimed;

  await logAudit({
    action: "quote.decline",
    entityType: "job_quote",
    entityId: q.id,
    metadata: { job_id: q.job_id, total: q.total, reason: cleanReason },
  });

  const { data: job } = await admin
    .from("jobs")
    .select("customer:customers(full_name), vehicle:vehicles(registration)")
    .eq("id", q.job_id)
    .maybeSingle();
  type JobRow = {
    customer: { full_name: string | null } | null;
    vehicle: { registration: string | null } | null;
  };
  const jobRow = job as JobRow | null;

  void notifyStaffOfDecision({
    quoteId: q.id,
    jobId: q.job_id,
    locationId: q.location_id,
    decision: "declined",
    declineReason: cleanReason,
    total: q.total,
    vehicleReg: jobRow?.vehicle?.registration ?? null,
    customerName: jobRow?.customer?.full_name ?? null,
    createdBy: q.created_by,
  });

  return { success: true };
}
