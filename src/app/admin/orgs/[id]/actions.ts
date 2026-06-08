"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPlatformAdminUser } from "@/lib/platform-admin";
import { validateSlug } from "@/lib/slug";
import { findSlugConflict } from "@/lib/slug-availability";
import { logAudit } from "@/lib/audit";

async function requirePlatformAdmin(): Promise<{ id: string; email?: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!(await isPlatformAdminUser(user))) redirect("/admin/login");
  return user!;
}

export type SlugResult = { error: string } | { success: true; slug: string };

// Change a location's slug (its subdomain). Platform-admin only. Validates the
// format/reserved list, enforces global uniqueness across organizations AND
// locations (a subdomain must be unique across both, like at signup), and keeps
// the org slug in sync when it currently matches the location's old slug (the
// single-location case where they were created equal).
//
// WARNING surfaced in the UI: this changes the garage's web address — old links,
// bookmarks, and already-sent email links stop resolving.
export async function updateLocationSlug(formData: FormData): Promise<SlugResult> {
  const actor = await requirePlatformAdmin();

  const locationId = String(formData.get("locationId") ?? "");
  const rawSlug = String(formData.get("slug") ?? "");
  if (!locationId) return { error: "Missing location." };

  const slug = rawSlug.trim().toLowerCase();
  const formatError = validateSlug(slug);
  if (formatError) return { error: formatError };

  const admin = createAdminClient();

  const { data: location } = await admin
    .from("locations")
    .select("id, slug, organization_id")
    .eq("id", locationId)
    .maybeSingle();
  if (!location) return { error: "Location not found." };

  const oldSlug = location.slug;
  if (slug === oldSlug) return { success: true, slug };

  // Global uniqueness across orgs, locations, AND retired slugs (history).
  const conflict = await findSlugConflict(admin, slug, {
    excludeLocationId: locationId,
    excludeOrgId: location.organization_id,
  });
  if (conflict) return { error: conflict };

  const { error: updErr } = await admin.from("locations").update({ slug }).eq("id", locationId);
  if (updErr) {
    // Unique-constraint violation under a race, or other DB error.
    return { error: updErr.message.includes("duplicate") ? "That subdomain was just taken." : updErr.message };
  }

  // Permanently reserve the old slug + point its subdomain at this location, so
  // the proxy can 308-redirect old links and no one can reuse it.
  await admin
    .from("location_slug_history")
    .upsert(
      { old_slug: oldSlug, location_id: locationId, organization_id: location.organization_id },
      { onConflict: "old_slug", ignoreDuplicates: true },
    );

  // Keep the org slug in sync when it mirrored the old location slug.
  const { data: org } = await admin
    .from("organizations")
    .select("slug")
    .eq("id", location.organization_id)
    .maybeSingle();
  if (org?.slug === oldSlug) {
    await admin.from("organizations").update({ slug }).eq("id", location.organization_id);
  }

  await logAudit({
    action: "location.slug_change",
    actorUserId: actor.id,
    actorEmail: actor.email ?? null,
    organizationId: location.organization_id,
    entityType: "location",
    entityId: locationId,
    metadata: { old_slug: oldSlug, new_slug: slug, via: "platform_admin", org_slug_synced: org?.slug === oldSlug },
  });

  revalidatePath(`/admin/orgs/${location.organization_id}`);
  return { success: true, slug };
}
