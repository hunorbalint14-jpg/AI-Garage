"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { draftSiteCopy, type SiteCopy } from "@/lib/ai-minisite-copy";
import { getOrgAiBrief } from "@/lib/ai-profile";
import type { MiniSiteSectionKey } from "@/lib/minisite-data";

// Mini-site settings (#507 PR 2). Owner/admin only — publishing a public
// marketing page is an org decision.

export type SaveSiteResult = { error: string } | { success: true };

const SECTION_KEYS: MiniSiteSectionKey[] = ["services", "hours", "branches", "reviews", "about"];

export async function saveSiteSettings(input: {
  published: boolean;
  sections: Record<string, boolean>;
  strapline: string;
  about: string;
}): Promise<SaveSiteResult> {
  const ctx = await requireStaffContext();
  if (ctx.orgRole !== "owner" && ctx.orgRole !== "admin") return { error: "Permission denied." };
  const admin = createAdminClient();

  const sections: Record<string, boolean> = {};
  for (const key of SECTION_KEYS) sections[key] = input.sections[key] !== false;

  const { data: before } = await admin
    .from("org_sites")
    .select("published")
    .eq("organization_id", ctx.organization.id)
    .maybeSingle();
  const wasPublished = (before as { published: boolean } | null)?.published ?? false;

  const { error } = await admin.from("org_sites").upsert({
    organization_id: ctx.organization.id,
    published: input.published,
    sections,
    strapline: input.strapline.trim().slice(0, 160) || null,
    about: input.about.trim().slice(0, 2000) || null,
    updated_at: new Date().toISOString(),
  });
  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action:
      input.published === wasPublished ? "site.updated" : input.published ? "site.published" : "site.unpublished",
    entityType: "organization",
    entityId: ctx.organization.id,
    metadata: { sections },
  });

  revalidatePath("/");
  revalidatePath("/staff/settings");
  return { success: true };
}

// AI copy draft (#507 PR 4): fills the form fields only — the human edits
// and presses Save; nothing is published by this action.
export async function draftSiteCopyAction(): Promise<{ error: string } | SiteCopy> {
  const ctx = await requireStaffContext();
  if (ctx.orgRole !== "owner" && ctx.orgRole !== "admin") return { error: "Permission denied." };
  const admin = createAdminClient();

  try {
    const { data: svcRows } = await admin
      .from("services")
      .select("name, location:locations!inner(organization_id)")
      .eq("location.organization_id", ctx.organization.id)
      .eq("active", true)
      .limit(30);
    const { count: branchCount } = await admin
      .from("locations")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", ctx.organization.id);

    const copy = await draftSiteCopy(
      {
        orgName: ctx.organization.name,
        branchCount: branchCount ?? 1,
        services: [...new Set(((svcRows ?? []) as { name: string }[]).map((s) => s.name))],
        aiBrief: await getOrgAiBrief(admin, ctx.organization.id),
      },
      { locationId: ctx.location.id, organizationId: ctx.organization.id, userId: ctx.user.id, feature: "minisite_copy" },
    );
    if (!copy) return { error: "Couldn't draft copy this time — write it by hand or try again." };
    return copy;
  } catch (err) {
    console.error("[minisite] AI copy failed", err);
    return { error: "AI drafting is unavailable right now — the fields still work by hand." };
  }
}

// ── Gallery (#507 PR 4) ──────────────────────────────────────────────────────

const GALLERY_BUCKET = "site-gallery";
const MAX_PHOTOS = 8;
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const PHOTO_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp"];

export type GalleryResult = { error: string } | { success: true; paths: string[] };

export async function uploadGalleryPhoto(formData: FormData): Promise<GalleryResult> {
  const ctx = await requireStaffContext();
  if (ctx.orgRole !== "owner" && ctx.orgRole !== "admin") return { error: "Permission denied." };
  const admin = createAdminClient();

  const file = formData.get("photo") as File | null;
  if (!file || !file.size) return { error: "No file provided." };
  if (file.size > MAX_PHOTO_BYTES) return { error: "Photo too large (max 4 MB)." };
  if (!PHOTO_TYPES.includes(file.type)) return { error: "Use PNG, JPG or WEBP." };

  const { data: siteRow } = await admin
    .from("org_sites")
    .select("gallery_paths")
    .eq("organization_id", ctx.organization.id)
    .maybeSingle();
  const current = ((siteRow as { gallery_paths: string[] } | null)?.gallery_paths ?? []) as string[];
  if (current.length >= MAX_PHOTOS) return { error: `Gallery is full (max ${MAX_PHOTOS} photos).` };

  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `${ctx.organization.id}/photo-${Date.now()}.${ext}`;
  const { error: upErr } = await admin.storage
    .from(GALLERY_BUCKET)
    .upload(path, await file.arrayBuffer(), { contentType: file.type, upsert: false });
  if (upErr) return { error: `Upload failed: ${upErr.message}` };

  const paths = [...current, path];
  const { error } = await admin
    .from("org_sites")
    .upsert({ organization_id: ctx.organization.id, gallery_paths: paths, updated_at: new Date().toISOString() });
  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "site.updated",
    entityType: "organization",
    entityId: ctx.organization.id,
    metadata: { gallery: paths.length },
  });
  revalidatePath("/");
  revalidatePath("/staff/settings");
  return { success: true, paths };
}

export async function removeGalleryPhoto(path: string): Promise<GalleryResult> {
  const ctx = await requireStaffContext();
  if (ctx.orgRole !== "owner" && ctx.orgRole !== "admin") return { error: "Permission denied." };
  if (!path.startsWith(`${ctx.organization.id}/`)) return { error: "Not your photo." };
  const admin = createAdminClient();

  const { data: siteRow } = await admin
    .from("org_sites")
    .select("gallery_paths")
    .eq("organization_id", ctx.organization.id)
    .maybeSingle();
  const current = ((siteRow as { gallery_paths: string[] } | null)?.gallery_paths ?? []) as string[];
  const paths = current.filter((p) => p !== path);

  await admin.storage.from(GALLERY_BUCKET).remove([path]);
  const { error } = await admin
    .from("org_sites")
    .update({ gallery_paths: paths, updated_at: new Date().toISOString() })
    .eq("organization_id", ctx.organization.id);
  if (error) return { error: error.message };

  revalidatePath("/");
  revalidatePath("/staff/settings");
  return { success: true, paths };
}
