"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPlatformAdminUser } from "@/lib/platform-admin";
import { validateSlug } from "@/lib/slug";
import { findSlugConflict } from "@/lib/slug-availability";
import { logAudit } from "@/lib/audit";
import { cacheDel } from "@/lib/redis";
import { invalidateTenantCache } from "@/lib/tenant-data";
import { invalidateStaffLocationCache } from "@/lib/staff-context";

async function requirePlatformAdmin(): Promise<{ id: string; email?: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!(await isPlatformAdminUser(user))) redirect("/admin/login");
  return user!;
}

export type SlugResult = { error: string } | { success: true; slug: string };

// Change an organisation's slug (its subdomain). Platform-admin only. Validates
// the format/reserved list and enforces global uniqueness across organizations
// and retired slugs. The subdomain is the org slug now; locations carry internal
// branch identifiers that are not web addresses.
//
// WARNING surfaced in the UI: this changes the garage's web address — old links,
// bookmarks, and already-sent email links redirect to the new one.
export async function updateOrgSlug(formData: FormData): Promise<SlugResult> {
  const actor = await requirePlatformAdmin();

  const orgId = String(formData.get("orgId") ?? "");
  const rawSlug = String(formData.get("slug") ?? "");
  if (!orgId) return { error: "Missing organisation." };

  const slug = rawSlug.trim().toLowerCase();
  const formatError = validateSlug(slug);
  if (formatError) return { error: formatError };

  const admin = createAdminClient();

  const { data: org } = await admin
    .from("organizations")
    .select("id, slug")
    .eq("id", orgId)
    .maybeSingle();
  if (!org) return { error: "Organisation not found." };

  const oldSlug = org.slug;
  if (slug === oldSlug) return { success: true, slug };

  // Global uniqueness across orgs AND retired slugs (history).
  const conflict = await findSlugConflict(admin, slug, { excludeOrgId: orgId });
  if (conflict) return { error: conflict };

  const { error: updErr } = await admin.from("organizations").update({ slug }).eq("id", orgId);
  if (updErr) {
    // Unique-constraint violation under a race, or other DB error.
    return { error: updErr.message.includes("duplicate") ? "That subdomain was just taken." : updErr.message };
  }

  // Permanently reserve the old slug + point its subdomain at this org, so the
  // proxy can 308-redirect old links and no one can reuse it.
  await admin
    .from("org_slug_history")
    .upsert(
      { old_slug: oldSlug, organization_id: orgId },
      { onConflict: "old_slug", ignoreDuplicates: true },
    );

  await logAudit({
    action: "org.slug_change",
    actorUserId: actor.id,
    actorEmail: actor.email ?? null,
    organizationId: orgId,
    entityType: "organization",
    entityId: orgId,
    metadata: { old_slug: oldSlug, new_slug: slug, via: "platform_admin" },
  });

  // Evict the proxy's retired-slug cache for both slugs (old one now retired,
  // new one may have been cached as retired) + the cached tenant branding +
  // staff org row under both slugs. Best-effort; entries also expire by TTL.
  await Promise.all([cacheDel(`slughist:${oldSlug}`), cacheDel(`slughist:${slug}`)]);
  await invalidateTenantCache([oldSlug, slug]);
  await invalidateStaffLocationCache([oldSlug, slug]);

  revalidatePath(`/admin/orgs/${orgId}`);
  return { success: true, slug };
}
