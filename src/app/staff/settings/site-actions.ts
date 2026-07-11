"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
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
