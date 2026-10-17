"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import { logAudit } from "@/lib/audit";
import { invalidateTenantCacheForOrg } from "@/lib/tenant-data";
import { invalidateStaffLocationCacheForOrg } from "@/lib/staff-context";
import {
  COURTESY_TRIAL_MONTHS,
  courtesyTrialEnd,
  hasBilledSubscription,
  type CourtesyTrialMonths,
} from "@/lib/courtesy-trial";

export type TrialResult = { error: string } | { success: true; trialEnd: string | null };

type OrgTrialRow = {
  id: string;
  tenant_plan: string | null;
  tenant_subscription_status: string | null;
  tenant_trial_end: string | null;
};

async function loadOrg(orgId: string): Promise<OrgTrialRow | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("organizations")
    .select("id, tenant_plan, tenant_subscription_status, tenant_trial_end")
    .eq("id", orgId)
    .maybeSingle();
  return (data as OrgTrialRow | null) ?? null;
}

// Billing columns are read through the cached staff org row and tenant
// branding, so evict both or the garage keeps its old tier until TTL.
async function afterWrite(orgId: string) {
  await Promise.all([invalidateStaffLocationCacheForOrg(orgId), invalidateTenantCacheForOrg(orgId)]);
  revalidatePath(`/admin/orgs/${orgId}`);
  revalidatePath("/admin");
}

// Grant (or replace) a courtesy trial: a paid tier with no card and no Stripe
// subscription. Platform-admin only. The end date is counted from now, so
// re-granting on a live trial resets it rather than stacking. Refused while
// Stripe is billing the org — the subscription would decide the tier anyway.
export async function grantCourtesyTrial(formData: FormData): Promise<TrialResult> {
  const actor = await requirePlatformAdmin();

  const orgId = String(formData.get("orgId") ?? "");
  const tier = String(formData.get("tier") ?? "");
  const months = Number(formData.get("months"));
  if (!orgId) return { error: "Missing organisation." };
  if (tier !== "pro" && tier !== "growth") return { error: "Pick Pro or Growth." };
  if (!COURTESY_TRIAL_MONTHS.includes(months as CourtesyTrialMonths)) return { error: "Pick a trial length." };

  const org = await loadOrg(orgId);
  if (!org) return { error: "Organisation not found." };
  if (hasBilledSubscription(org)) {
    return {
      error: `This garage has a Stripe subscription (${org.tenant_subscription_status}). Change their plan in Stripe instead.`,
    };
  }

  const trialEnd = courtesyTrialEnd(new Date(), months).toISOString();
  const admin = createAdminClient();
  const { error } = await admin
    .from("organizations")
    .update({ tenant_plan: tier, tenant_trial_end: trialEnd })
    .eq("id", orgId);
  if (error) return { error: error.message };

  await logAudit({
    action: "org.trial_grant",
    actorUserId: actor.id,
    actorEmail: actor.email ?? null,
    organizationId: orgId,
    entityType: "organization",
    entityId: orgId,
    metadata: {
      tier,
      months,
      trial_end: trialEnd,
      previous_plan: org.tenant_plan,
      previous_trial_end: org.tenant_trial_end,
      via: "platform_admin",
    },
  });

  await afterWrite(orgId);
  return { success: true, trialEnd };
}

// End a live courtesy trial now. Leaves the tier stamped, so the garage lands
// in `trial_ended` (Starter features + fee, owner sees "trial ended") exactly
// as a natural expiry would — nothing is deleted.
export async function endCourtesyTrial(formData: FormData): Promise<TrialResult> {
  const actor = await requirePlatformAdmin();

  const orgId = String(formData.get("orgId") ?? "");
  if (!orgId) return { error: "Missing organisation." };

  const org = await loadOrg(orgId);
  if (!org) return { error: "Organisation not found." };
  if (!org.tenant_trial_end || new Date(org.tenant_trial_end) <= new Date()) {
    return { error: "This garage has no live trial." };
  }

  const trialEnd = new Date().toISOString();
  const admin = createAdminClient();
  const { error } = await admin.from("organizations").update({ tenant_trial_end: trialEnd }).eq("id", orgId);
  if (error) return { error: error.message };

  await logAudit({
    action: "org.trial_end",
    actorUserId: actor.id,
    actorEmail: actor.email ?? null,
    organizationId: orgId,
    entityType: "organization",
    entityId: orgId,
    metadata: {
      plan: org.tenant_plan,
      previous_trial_end: org.tenant_trial_end,
      via: "platform_admin",
    },
  });

  await afterWrite(orgId);
  return { success: true, trialEnd };
}
