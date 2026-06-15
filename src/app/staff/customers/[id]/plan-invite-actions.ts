"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { hasPermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { sendEmail } from "@/lib/email";
import { sendSms } from "@/lib/sms";
import {
  generatePlanInviteToken,
  generatePlanInviteSlug,
  hashPlanInviteToken,
  tenantPlanInviteUrl,
} from "@/lib/plan-invites";

export type InviteChannel = "email" | "sms";
export type SendInviteResult =
  | { error: string }
  | { url: string; sent: { email: boolean; sms: boolean } };

const INVITE_TTL_DAYS = 14;

// Staff create a tokenised plan-subscribe link for a customer and send it by the
// chosen channels. The customer subscribes (and pays) themselves via the link.
export async function sendPlanInvite(
  customerId: string,
  planId: string,
  channels: InviteChannel[],
): Promise<SendInviteResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "services")) return { error: "Permission denied." };
  const admin = createAdminClient();

  const { data: customer } = await admin
    .from("customers")
    .select("id, full_name, email, phone")
    .eq("id", customerId)
    .eq("organization_id", ctx.organization.id)
    .maybeSingle();
  const cust = customer as
    | { id: string; full_name: string | null; email: string | null; phone: string | null }
    | null;
  if (!cust) return { error: "Customer not found." };

  const { data: plan } = await admin
    .from("service_plans")
    .select("id, name, active")
    .eq("id", planId)
    .eq("organization_id", ctx.organization.id)
    .maybeSingle();
  const p = plan as { id: string; name: string; active: boolean } | null;
  if (!p || !p.active) return { error: "This plan isn't available." };

  // The customer can't pay unless the garage's Stripe Connect account is ready.
  const { data: orgRow } = await admin
    .from("organizations")
    .select("name, stripe_account_id, stripe_charges_enabled")
    .eq("id", ctx.organization.id)
    .maybeSingle();
  const org = orgRow as
    | { name: string; stripe_account_id: string | null; stripe_charges_enabled: boolean | null }
    | null;
  if (!org?.stripe_account_id || !org.stripe_charges_enabled) {
    return { error: "Finish Stripe payment setup before inviting customers to a plan." };
  }

  const wantEmail = channels.includes("email");
  const wantSms = channels.includes("sms");
  if (!wantEmail && !wantSms) return { error: "Pick at least one way to send the invite." };
  if (wantEmail && !cust.email) return { error: "This customer has no email address." };
  if (wantSms && !cust.phone) return { error: "This customer has no phone number." };

  const token = generatePlanInviteToken();
  const slug = generatePlanInviteSlug();
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { error: insErr } = await admin.from("plan_invites").insert({
    location_id: ctx.location.id,
    service_plan_id: p.id,
    customer_id: cust.id,
    slug,
    token_hash: hashPlanInviteToken(token),
    expires_at: expiresAt,
    created_by: ctx.user.id,
  });
  if (insErr) return { error: insErr.message };

  const url = tenantPlanInviteUrl(ctx.location.slug, slug, token);
  const sent = { email: false, sms: false };

  if (wantEmail && cust.email) {
    const res = await sendEmail({
      to: cust.email,
      subject: `Join the ${p.name} plan at ${org.name}`,
      text: `Hi${cust.full_name ? ` ${cust.full_name}` : ""},\n\n${org.name} has invited you to subscribe to the ${p.name} plan. Use the link below to choose monthly or annual billing and set up your membership.\n\nThis link expires in ${INVITE_TTL_DAYS} days.`,
      cta: { url, label: "View plan" },
    });
    sent.email = res.success;
  }
  if (wantSms && cust.phone) {
    const res = await sendSms({
      to: cust.phone,
      body: `${org.name}: subscribe to the ${p.name} plan here ${url} (expires in ${INVITE_TTL_DAYS} days).`,
    });
    sent.sms = res.success;
  }

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "plan.invite_sent",
    entityType: "service_plan",
    entityId: p.id,
    metadata: { customer_id: cust.id, channels, sent },
  });

  return { url, sent };
}

// Override the onboarding gate (docs §3.1): when a customer is enrolled right
// after a service + MOT, their next service is naturally ~12 months out, so they
// qualify for covered draws immediately (still gated by funding). Staff bring
// benefits_start_at forward to now. Only touches a subscription in this org.
export async function markPlanBenefitsStartNow(
  subscriptionId: string,
): Promise<{ error: string } | { success: true }> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "services")) return { error: "Permission denied." };
  const admin = createAdminClient();

  const { data: subRow } = await admin
    .from("plan_subscriptions")
    .select("id, customer_id")
    .eq("id", subscriptionId)
    .eq("organization_id", ctx.organization.id)
    .maybeSingle();
  const sub = subRow as { id: string; customer_id: string | null } | null;
  if (!sub) return { error: "Subscription not found." };

  const now = new Date().toISOString();
  const { error } = await admin
    .from("plan_subscriptions")
    .update({ benefits_start_at: now, updated_at: now })
    .eq("id", sub.id);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "plan.benefits_start_override",
    entityType: "service_plan",
    entityId: sub.id,
    metadata: { customer_id: sub.customer_id, benefits_start_at: now, reason: "enrolled_after_service_mot" },
  });

  if (sub.customer_id) revalidatePath(`/staff/customers/${sub.customer_id}`);
  return { success: true };
}
