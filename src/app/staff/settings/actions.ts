"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { hasPermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateSlug } from "@/lib/slug";
import { logAudit } from "@/lib/audit";
import { tierFor, tenantBillingActive, TIERS } from "@/lib/tenant-plans";

export type UpdateOrgResult = { error: string } | { success: true };

export async function updateOrganization(
  formData: FormData,
): Promise<UpdateOrgResult> {
  const ctx = await requireStaffContext();

  if (!hasPermission(ctx, "org_settings")) {
    return { error: "Permission denied." };
  }

  const name = (formData.get("name") as string | null)?.trim();
  const primaryColor = (formData.get("primaryColor") as string | null)?.trim();
  const phone = (formData.get("phone") as string | null)?.trim() || null;
  const googleReviewUrl = (formData.get("googleReviewUrl") as string | null)?.trim() || null;
  const privacyPolicyUrl = (formData.get("privacyPolicyUrl") as string | null)?.trim() || null;

  if (!name) return { error: "Organization name is required." };
  if (primaryColor && !/^#[0-9a-fA-F]{6}$/.test(primaryColor)) {
    return { error: "Primary color must be a valid hex colour (e.g. #1f2937)." };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("organizations")
    .update({
      name,
      ...(primaryColor ? { primary_color: primaryColor } : {}),
      phone,
      google_review_url: googleReviewUrl,
      privacy_policy_url: privacyPolicyUrl,
    })
    .eq("id", ctx.organization.id);

  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "settings.update",
    entityType: "organization",
    entityId: ctx.organization.id,
    metadata: {
      name,
      primary_color: primaryColor ?? null,
      phone,
      google_review_url: googleReviewUrl,
      privacy_policy_url: privacyPolicyUrl,
    },
  });

  revalidatePath("/staff/settings");
  revalidatePath("/staff");
  revalidatePath("/");
  return { success: true };
}

export type UpdateHoursResult = { error: string } | { success: true };

export async function updateBusinessHours(
  formData: FormData,
): Promise<UpdateHoursResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "org_settings")) {
    return { error: "Permission denied." };
  }

  const start = parseInt(formData.get("hoursStart") as string, 10);
  const end = parseInt(formData.get("hoursEnd") as string, 10);

  if (isNaN(start) || isNaN(end) || start < 0 || end > 23 || start >= end) {
    return { error: "Invalid hours. Start must be before end (0–23)." };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("locations")
    .update({ business_hours_start: start, business_hours_end: end })
    .eq("id", ctx.location.id);

  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "settings.business_hours_update",
    entityType: "location",
    entityId: ctx.location.id,
    metadata: { hours_start: start, hours_end: end },
  });

  revalidatePath("/staff/settings");
  revalidatePath("/staff");
  return { success: true };
}

export type AddLocationResult =
  | { error: string }
  | { success: true; slug: string };

export async function addLocation(
  formData: FormData,
): Promise<AddLocationResult> {
  const ctx = await requireStaffContext();

  if (!hasPermission(ctx, "org_settings")) {
    return { error: "Permission denied." };
  }

  const name = (formData.get("name") as string | null)?.trim();
  const slugInput = (formData.get("slug") as string | null)?.trim().toLowerCase();

  if (!name) return { error: "Location name is required." };
  if (!slugInput) return { error: "Subdomain is required." };

  const slugError = validateSlug(slugInput);
  if (slugError) return { error: slugError };

  const admin = createAdminClient();

  // Tier location limit (lapsed/past-grace tenants fall back to the Starter cap).
  const maxLocations = tenantBillingActive(ctx.tenantBilling)
    ? tierFor(ctx.tenantBilling).maxLocations
    : TIERS.starter.maxLocations;
  const { count: locationCount } = await admin
    .from("locations")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", ctx.organization.id);
  if ((locationCount ?? 0) >= maxLocations) {
    const allowed = maxLocations === Number.POSITIVE_INFINITY ? "unlimited" : maxLocations;
    return { error: `Your plan includes ${allowed} location${maxLocations === 1 ? "" : "s"}. Upgrade in Settings → Billing to add more.` };
  }

  const { data: existing } = await admin
    .from("locations")
    .select("id")
    .eq("slug", slugInput)
    .maybeSingle();
  if (existing) return { error: "That subdomain is already taken." };

  const { data: created, error } = await admin
    .from("locations")
    .insert({
      organization_id: ctx.organization.id,
      slug: slugInput,
      name,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "settings.location_add",
    entityType: "location",
    entityId: created?.id ?? null,
    metadata: { slug: slugInput, name },
  });

  revalidatePath("/staff/settings");
  return { success: true, slug: slugInput };
}
