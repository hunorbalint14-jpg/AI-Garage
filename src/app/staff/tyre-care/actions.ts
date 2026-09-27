"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { hasPermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { sendEmail, tenantBookingUrl } from "@/lib/email";
import { sendSms } from "@/lib/sms";
import { garageLabel, garageLocationBlock, garageLocationInline } from "@/lib/garage-identity";
import { mintUnsubscribeToken } from "@/lib/unsubscribe";
import { generateTyreCareBookToken, hashTyreCareBookToken } from "@/lib/tyre-care-links";
import { loadContactStates } from "@/lib/tyre-care-contact";
import { SERVICE_LABEL } from "@/lib/tyre-care-messages";
import type { Evidence, ServiceType } from "@/lib/tyre-care";

// Tyre-care review queue actions (#596 PR 4). Staff judgement is the point of
// the queue — a dismissal is recorded with its reason, and the rejection rate
// is the false-positive signal the thresholds get tuned against.

type ActionResult = { error: string } | { success: true };

async function ownRecommendation(admin: ReturnType<typeof createAdminClient>, locationId: string, id: string) {
  const { data } = await admin
    .from("tyre_recommendations")
    .select("id, location_id, status, service_type, vehicle_id")
    .eq("id", id)
    .maybeSingle();
  const row = data as {
    id: string;
    location_id: string;
    status: string;
    service_type: string;
    vehicle_id: string;
  } | null;
  return row && row.location_id === locationId ? row : null;
}

export async function dismissTyreRecommendation(id: string, reason: string | null): Promise<ActionResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "reminders")) return { error: "Permission denied." };
  const admin = createAdminClient();

  const row = await ownRecommendation(admin, ctx.location.id, id);
  if (!row) return { error: "Recommendation not found." };
  if (row.status !== "pending_review") return { error: "Only recommendations awaiting review can be dismissed." };

  const cleanReason = reason?.trim().slice(0, 500) || null;
  const nowIso = new Date().toISOString();
  const { data, error } = await admin
    .from("tyre_recommendations")
    .update({
      status: "dismissed",
      dismissed_reason: cleanReason,
      reviewed_by: ctx.user.id,
      reviewed_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", id)
    .eq("status", "pending_review")
    .select("id");
  if (error) return { error: error.message };
  // The nightly run can expire an item between page load and click.
  if (!data || data.length === 0) return { error: "This recommendation has just changed — refresh the page." };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "tyre_care.dismissed",
    entityType: "tyre_recommendation",
    entityId: id,
    metadata: { reason: cleanReason, service_type: row.service_type, vehicle_id: row.vehicle_id },
  });
  revalidatePath("/staff/tyre-care");
  return { success: true };
}

/**
 * Put a dismissed item back in the queue. The next nightly run then either
 * refreshes it (still due) or expires it (no longer due) — so reopening can't
 * resurrect a recommendation whose evidence has gone.
 */
export async function reopenTyreRecommendation(id: string): Promise<ActionResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "reminders")) return { error: "Permission denied." };
  const admin = createAdminClient();

  const row = await ownRecommendation(admin, ctx.location.id, id);
  if (!row) return { error: "Recommendation not found." };
  if (row.status !== "dismissed") return { error: "Only dismissed recommendations can be reopened." };

  const { data, error } = await admin
    .from("tyre_recommendations")
    .update({
      status: "pending_review",
      dismissed_reason: null,
      reviewed_by: null,
      reviewed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "dismissed")
    .select("id");
  if (error) {
    // One open item per vehicle and service — the nightly run may have
    // raised a fresh one since this was dismissed.
    if (error.code === "23505") return { error: "There's already an open recommendation for this vehicle and service." };
    return { error: error.message };
  }
  if (!data || data.length === 0) return { error: "This recommendation has just changed — refresh the page." };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "tyre_care.reopened",
    entityType: "tyre_recommendation",
    entityId: id,
    metadata: { service_type: row.service_type, vehicle_id: row.vehicle_id },
  });
  revalidatePath("/staff/tyre-care");
  return { success: true };
}

// ── Approve & send (#596 PR 5) ───────────────────────────────────────────────

export type SendChannels = { email: boolean; sms: boolean };
export type SendMessage = { subject: string; emailText: string; smsText: string };
export type SendTyreCareResult = { error: string } | { success: true; channels: string[] };

type SendRow = {
  id: string;
  location_id: string;
  status: string;
  service_type: ServiceType;
  evidence: Evidence;
  customer: {
    id: string;
    full_name: string | null;
    email: string | null;
    phone: string | null;
    marketing_email_consent: boolean;
    marketing_sms_consent: boolean;
    anonymized_at: string | null;
  } | null;
  vehicle: { id: string; registration: string | null; make: string | null } | null;
};

/**
 * Staff approve a recommendation and send it. Everything is checked before a
 * single message goes out — consent and a message for every ticked channel,
 * the contact limits, the wheel setup for rotation — so a send is never a
 * silently dropped channel.
 */
export async function approveAndSendTyreRecommendation(
  id: string,
  message: SendMessage,
  channels: SendChannels,
): Promise<SendTyreCareResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "reminders")) return { error: "Permission denied." };
  const admin = createAdminClient();

  const { data } = await admin
    .from("tyre_recommendations")
    .select(
      "id, location_id, status, service_type, evidence, customer:customers(id, full_name, email, phone, marketing_email_consent, marketing_sms_consent, anonymized_at), vehicle:vehicles(id, registration, make)",
    )
    .eq("id", id)
    .maybeSingle();
  const rec = data as unknown as SendRow | null;
  if (!rec || rec.location_id !== ctx.location.id) return { error: "Recommendation not found." };
  if (rec.status !== "pending_review") return { error: "This recommendation has already been handled." };
  const customer = rec.customer;
  const vehicle = rec.vehicle;
  if (!customer || !vehicle) return { error: "Customer or vehicle not found." };
  if (customer.anonymized_at) return { error: "This customer has been anonymised." };

  // Recommending a physically impossible rotation in writing is the fastest
  // way to lose a customer's trust — someone must have confirmed the setup.
  if (rec.service_type === "rotation") {
    const { data: profile } = await admin
      .from("vehicle_wheel_profile")
      .select("tyre_config")
      .eq("vehicle_id", vehicle.id)
      .maybeSingle();
    if ((profile as { tyre_config: string } | null)?.tyre_config !== "standard") {
      return { error: "Confirm the wheel setup on the vehicle page before recommending a rotation." };
    }
  }

  const emailText = message.emailText.trim();
  const smsText = message.smsText.trim();
  if (!channels.email && !channels.sms) return { error: "Pick at least one channel." };
  if (channels.email) {
    if (!customer.email) return { error: "No email address on file — untick Email." };
    if (!customer.marketing_email_consent) return { error: "No marketing consent for email — untick Email." };
    if (!emailText) return { error: "The email message is empty." };
  }
  if (channels.sms) {
    if (!customer.phone) return { error: "No phone number on file — untick SMS." };
    if (!customer.marketing_sms_consent) return { error: "No marketing consent for texts — untick SMS." };
    if (!smsText) return { error: "The text message is empty." };
  }

  const contact = (await loadContactStates(admin, [customer.id])).get(customer.id);
  if (contact && !contact.cap.allowed) {
    return {
      error: contact.cap.availableFrom
        ? `${contact.cap.reason} You can send from ${contact.cap.availableFrom}.`
        : contact.cap.reason,
    };
  }

  const { data: loc } = await admin.from("locations").select("name, address").eq("id", rec.location_id).maybeSingle();
  const location = loc as { name: string; address: string | null } | null;
  const identity = {
    orgName: ctx.organization.name,
    locationName: location?.name ?? null,
    address: location?.address ?? null,
  };

  // Claim before sending: a double click, or a second member of staff on the
  // same row, can't send the same recommendation twice.
  const bookToken = generateTyreCareBookToken();
  const nowIso = new Date().toISOString();
  const { data: claimed, error: claimError } = await admin
    .from("tyre_recommendations")
    .update({
      status: "approved_sent",
      book_token_hash: hashTyreCareBookToken(bookToken),
      sent_at: nowIso,
      reviewed_by: ctx.user.id,
      reviewed_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", rec.id)
    .eq("status", "pending_review")
    .select("id");
  if (claimError) return { error: claimError.message };
  if (!claimed || claimed.length === 0) return { error: "This recommendation has just changed — refresh the page." };

  const rollback = () =>
    admin
      .from("tyre_recommendations")
      .update({ status: "pending_review", book_token_hash: null, sent_at: null, reviewed_by: null, reviewed_at: null })
      .eq("id", rec.id)
      .eq("status", "approved_sent");

  let unsubToken: string;
  try {
    unsubToken = await mintUnsubscribeToken(admin, {
      customerId: customer.id,
      organizationId: ctx.organization.id,
      source: "tyre_care",
    });
  } catch (err) {
    await rollback();
    return { error: err instanceof Error ? err.message : "Couldn't create the unsubscribe link." };
  }

  const bookUrl = tenantBookingUrl(ctx.organization.slug, `/book?tc=${bookToken}`);
  const unsubscribePage = tenantBookingUrl(ctx.organization.slug, `/unsubscribe?u=${unsubToken}`);
  const unsubscribeOneClick = tenantBookingUrl(ctx.organization.slug, `/api/unsubscribe?u=${unsubToken}`);
  const registration = vehicle.registration ?? "your vehicle";
  const serviceTitle = SERVICE_LABEL[rec.service_type].replace(/^./, (c) => c.toUpperCase());
  const subject = message.subject.trim() || `${serviceTitle} recommended for ${registration} — ${garageLabel(identity)}`;

  const sent: string[] = [];
  const failures: string[] = [];
  const logRow = {
    location_id: rec.location_id,
    customer_id: customer.id,
    vehicle_id: vehicle.id,
    type: "tyre_care",
    subject,
  };

  if (channels.email) {
    const result = await sendEmail({
      to: customer.email!,
      subject,
      text: `${emailText}\n\n${garageLocationBlock(identity)}`,
      cta: { url: bookUrl, label: "Book it in" },
      unsubscribe: { pageUrl: unsubscribePage, oneClickUrl: unsubscribeOneClick },
    });
    await admin.from("reminders").insert({
      ...logRow,
      channel: "email",
      recipient_email: customer.email,
      recipient_phone: null,
      message_text: emailText,
      status: result.success ? "sent" : "failed",
      error_message: result.success ? null : result.error,
      resend_email_id: result.success ? result.messageId : null,
    });
    if (result.success) sent.push("email");
    else failures.push(`email failed: ${result.error}`);
  }

  if (channels.sms) {
    const body = `${smsText} ${bookUrl} — ${garageLocationInline(identity)}. Opt out: ${unsubscribePage}`;
    const result = await sendSms({ to: customer.phone!, body });
    await admin.from("reminders").insert({
      ...logRow,
      channel: "sms",
      recipient_email: null,
      recipient_phone: customer.phone,
      message_text: smsText,
      status: result.success ? "sent" : "failed",
      error_message: result.success ? null : result.error,
    });
    if (result.success) sent.push("sms");
    else failures.push(`sms failed: ${result.error}`);
  }

  if (sent.length === 0) {
    // Nothing reached the customer — put it back in the queue to try again.
    await rollback();
    return { error: `Nothing was sent — ${failures.join("; ")}.` };
  }

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "tyre_care.sent",
    entityType: "tyre_recommendation",
    entityId: rec.id,
    metadata: {
      service_type: rec.service_type,
      rule_key: rec.evidence?.rule_key ?? null,
      customer_id: customer.id,
      vehicle_id: vehicle.id,
      channels: sent,
      failed: failures,
    },
  });

  revalidatePath("/staff/tyre-care");
  return { success: true, channels: [...sent, ...failures] };
}
