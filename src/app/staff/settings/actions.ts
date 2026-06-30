"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { hasPermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { findSlugConflict } from "@/lib/slug-availability";
import { logAudit } from "@/lib/audit";
import { invalidateTenantCacheForOrg } from "@/lib/tenant-data";
import { invalidateStaffLocationCacheForOrg } from "@/lib/staff-context";
import { tierFor, tenantBillingActive, TIERS } from "@/lib/tenant-plans";
import { APP_TZ, type WeeklyHours } from "@/lib/business-hours";

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

  // Name/colour are cached per tenant slug — drop the org's cached branding
  // (public tenant cache + the staff context's location/org cache).
  await invalidateTenantCacheForOrg(ctx.organization.id);
  await invalidateStaffLocationCacheForOrg(ctx.organization.id);

  revalidatePath("/staff/settings");
  revalidatePath("/staff");
  revalidatePath("/");
  return { success: true };
}

export type UpdateHoursResult = { error: string } | { success: true };

// Validate the submitted weekly-hours JSON into a clean {weekday:{open,close}}
// object (minutes). Returns null on anything malformed/empty.
function parseSubmittedWeekly(raw: string | null): WeeklyHours | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const out: WeeklyHours = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    const wd = Number(k);
    const open = (v as { open?: unknown })?.open;
    const close = (v as { close?: unknown })?.close;
    if (
      Number.isInteger(wd) && wd >= 0 && wd <= 6 &&
      Number.isInteger(open) && Number.isInteger(close) &&
      (open as number) >= 0 && (close as number) <= 1440 && (open as number) < (close as number)
    ) {
      out[wd] = { open: open as number, close: close as number };
    }
  }
  return Object.keys(out).length === 0 ? null : out;
}

export async function updateBusinessHours(
  formData: FormData,
): Promise<UpdateHoursResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "org_settings")) {
    return { error: "Permission denied." };
  }

  const weekly = parseSubmittedWeekly(formData.get("weekly") as string | null);
  if (!weekly) {
    return { error: "Set valid hours for at least one open day." };
  }

  // Keep the legacy scalar columns as a coarse mirror (week's min-open hour /
  // max-close hour) — the dashboard_stats RPC still reads them for the today
  // grid. business_hours (jsonb) is the source of truth everywhere else.
  const opens = Object.values(weekly).map((h) => h.open);
  const closes = Object.values(weekly).map((h) => h.close);
  const hoursStart = Math.floor(Math.min(...opens) / 60);
  const hoursEnd = Math.ceil(Math.max(...closes) / 60);

  const admin = createAdminClient();
  const { error } = await admin
    .from("locations")
    .update({ business_hours: weekly, business_hours_start: hoursStart, business_hours_end: hoursEnd })
    .eq("id", ctx.location.id);

  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "settings.business_hours_update",
    entityType: "location",
    entityId: ctx.location.id,
    metadata: { business_hours: weekly },
  });

  revalidatePath("/staff/settings");
  revalidatePath("/staff");
  return { success: true };
}

export type SpecialHoursResult = { error: string } | { success: true };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function addSpecialHours(formData: FormData): Promise<SpecialHoursResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "org_settings")) return { error: "Permission denied." };

  const date = (formData.get("date") as string | null)?.trim() ?? "";
  if (!DATE_RE.test(date)) return { error: "Pick a valid date." };
  // Reject past dates (compare calendar days, garage timezone).
  const todayKey = new Date().toLocaleDateString("en-CA", { timeZone: APP_TZ });
  if (date < todayKey) return { error: "Date must be today or later." };

  const isClosed = formData.get("isClosed") === "1";
  let openMinute: number | null = null;
  let closeMinute: number | null = null;
  if (!isClosed) {
    openMinute = parseInt(formData.get("openMinute") as string, 10);
    closeMinute = parseInt(formData.get("closeMinute") as string, 10);
    if (
      !Number.isInteger(openMinute) || !Number.isInteger(closeMinute) ||
      openMinute < 0 || closeMinute > 1440 || openMinute >= closeMinute
    ) {
      return { error: "Opening time must be before closing time." };
    }
  }
  const note = ((formData.get("note") as string | null) ?? "").trim().slice(0, 120) || null;

  const admin = createAdminClient();
  // Upsert so re-adding the same date replaces it (one override per date).
  const { error } = await admin
    .from("location_special_hours")
    .upsert(
      {
        location_id: ctx.location.id,
        date,
        is_closed: isClosed,
        open_minute: openMinute,
        close_minute: closeMinute,
        note,
      },
      { onConflict: "location_id,date" },
    );
  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "settings.special_hours_add",
    entityType: "location",
    entityId: ctx.location.id,
    metadata: { date, is_closed: isClosed, open_minute: openMinute, close_minute: closeMinute },
  });

  revalidatePath("/staff/settings");
  return { success: true };
}

export async function removeSpecialHours(formData: FormData): Promise<SpecialHoursResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "org_settings")) return { error: "Permission denied." };

  const id = (formData.get("id") as string | null)?.trim();
  if (!id) return { error: "Missing id." };

  const admin = createAdminClient();
  // Scope the delete to the active branch so a member can't remove another
  // branch's override by id.
  const { error } = await admin
    .from("location_special_hours")
    .delete()
    .eq("id", id)
    .eq("location_id", ctx.location.id);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "settings.special_hours_remove",
    entityType: "location",
    entityId: ctx.location.id,
    metadata: { id },
  });

  revalidatePath("/staff/settings");
  return { success: true };
}

export type AddLocationResult =
  | { error: string }
  | { success: true; name: string };

// Derive a URL-safe slug fragment from a branch name.
function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}

// Find a unique slug for a new branch — owners no longer type a subdomain; we
// generate one from the org slug + branch name and de-dupe against the shared
// slug namespace (orgs + locations + retired slugs).
async function generateLocationSlug(
  admin: ReturnType<typeof createAdminClient>,
  orgSlug: string,
  name: string,
): Promise<string> {
  const namePart = slugifyName(name) || "branch";
  const base = `${orgSlug}-${namePart}`.replace(/^-+|-+$/g, "").slice(0, 50) || namePart;
  let candidate = base;
  for (let n = 2; await findSlugConflict(admin, candidate); n++) {
    candidate = `${base}-${n}`;
  }
  return candidate;
}

export async function addLocation(
  formData: FormData,
): Promise<AddLocationResult> {
  const ctx = await requireStaffContext();

  if (!hasPermission(ctx, "org_settings")) {
    return { error: "Permission denied." };
  }

  const name = (formData.get("name") as string | null)?.trim();
  if (!name) return { error: "Location name is required." };

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

  const slug = await generateLocationSlug(admin, ctx.organization.slug, name);

  const { data: created, error } = await admin
    .from("locations")
    .insert({
      organization_id: ctx.organization.id,
      slug,
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
    metadata: { slug, name },
  });

  revalidatePath("/staff/settings");
  return { success: true, name };
}

export type LocationActionResult = { error: string } | { success: true };

// Edit a branch's display name + postal address. The address feeds every
// client-facing communication (so customers know which site to attend); the
// slug/subdomain is deliberately NOT editable here — that stays platform-admin-
// only (the /admin console).
export async function renameLocation(formData: FormData): Promise<LocationActionResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "org_settings")) return { error: "Permission denied." };

  const locationId = (formData.get("locationId") as string | null)?.trim();
  const name = (formData.get("name") as string | null)?.trim();
  // Address is optional; empty clears it. Cap length so a paste can't bloat
  // every reminder/confirmation body.
  const address = ((formData.get("address") as string | null) ?? "").trim().slice(0, 500) || null;
  if (!locationId) return { error: "Location is required." };
  if (!name) return { error: "Location name is required." };

  const admin = createAdminClient();
  const { data: loc } = await admin
    .from("locations")
    .select("id, name")
    .eq("id", locationId)
    .eq("organization_id", ctx.organization.id)
    .maybeSingle();
  if (!loc) return { error: "Location not found." };

  const { error } = await admin.from("locations").update({ name, address }).eq("id", locationId);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "settings.location_rename",
    entityType: "location",
    entityId: locationId,
    metadata: { from: (loc as { name: string | null }).name, to: name, address },
  });

  // Name shows in tenant branding + the staff switcher — evict both caches.
  await invalidateTenantCacheForOrg(ctx.organization.id);
  await invalidateStaffLocationCacheForOrg(ctx.organization.id);
  revalidatePath("/staff/settings");
  return { success: true };
}

// Set the org's primary/default branch (organizations.primary_location_id) —
// the fallback used for public branding, the portal, and the active-branch
// default.
export async function setPrimaryLocation(formData: FormData): Promise<LocationActionResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "org_settings")) return { error: "Permission denied." };

  const locationId = (formData.get("locationId") as string | null)?.trim();
  if (!locationId) return { error: "Location is required." };

  const admin = createAdminClient();
  const { data: loc } = await admin
    .from("locations")
    .select("id, name")
    .eq("id", locationId)
    .eq("organization_id", ctx.organization.id)
    .maybeSingle();
  if (!loc) return { error: "Location not found." };

  const { error } = await admin
    .from("organizations")
    .update({ primary_location_id: locationId })
    .eq("id", ctx.organization.id);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "settings.location_set_primary",
    entityType: "location",
    entityId: locationId,
    metadata: { name: (loc as { name: string | null }).name },
  });

  await invalidateTenantCacheForOrg(ctx.organization.id);
  await invalidateStaffLocationCacheForOrg(ctx.organization.id);
  revalidatePath("/staff/settings");
  return { success: true };
}
