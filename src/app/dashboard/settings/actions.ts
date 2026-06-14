"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getPortalContext } from "@/lib/portal-auth";
import { logAudit } from "@/lib/audit";

export type PrefsResult = { error: string } | { success: true };

// Customer-managed marketing contact preferences. Mirrors the staff-side
// updateConsent() in customers/[id]/gdpr-actions.ts (same columns + audit
// action), but authorised by the portal session instead of staff permissions.
// Only marketing consent is controlled here — transactional messages
// (MOT/service reminders, invoices, quote responses) are unaffected.
export async function updateContactPreferences(emailConsent: boolean, smsConsent: boolean): Promise<PrefsResult> {
  const { user, location, customer } = await getPortalContext();
  if (!customer) return { error: "We couldn't find your account." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("customers")
    .update({
      marketing_email_consent: emailConsent,
      marketing_sms_consent: smsConsent,
      consent_updated_at: new Date().toISOString(),
    })
    .eq("id", customer.id);

  if (error) return { error: error.message };

  await logAudit({
    organizationId: location.organization.id,
    actorUserId: user.id,
    actorEmail: user.email ?? null,
    action: "customer.consent_update",
    entityType: "customer",
    entityId: customer.id,
    metadata: { email_consent: emailConsent, sms_consent: smsConsent, via: "portal" },
  });

  return { success: true };
}
