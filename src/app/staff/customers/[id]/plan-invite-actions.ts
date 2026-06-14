"use server";

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
