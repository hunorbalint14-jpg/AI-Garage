"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { invalidateTenantCacheForOrg } from "@/lib/tenant-data";
import { invalidateStaffLocationCacheForOrg } from "@/lib/staff-context";

const BUCKET = "org-logos";
const MAX_SIZE = 2 * 1024 * 1024; // 2 MB
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/svg+xml"];

export type UploadResult = { error: string } | { success: true; url: string };

export async function uploadOrgLogo(formData: FormData): Promise<UploadResult> {
  const ctx = await requireStaffContext();
  if (ctx.orgRole !== "owner" && ctx.orgRole !== "admin") {
    return { error: "Only owners and admins can change the logo." };
  }

  const file = formData.get("logo") as File | null;
  if (!file || !file.size) return { error: "No file provided." };
  if (file.size > MAX_SIZE) return { error: "File too large (max 2 MB)." };
  if (!ALLOWED_TYPES.includes(file.type)) {
    return { error: "Unsupported format. Use PNG, JPG, WEBP, or SVG." };
  }

  const admin = createAdminClient();
  const ext = file.name.split(".").pop()?.toLowerCase() || "png";
  const path = `${ctx.organization.id}/logo-${Date.now()}.${ext}`;

  const arrayBuffer = await file.arrayBuffer();
  const { error: uploadErr } = await admin.storage
    .from(BUCKET)
    .upload(path, arrayBuffer, {
      contentType: file.type,
      upsert: true,
    });
  if (uploadErr) return { error: `Upload failed: ${uploadErr.message}` };

  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);
  const url = pub.publicUrl;

  const { error: updateErr } = await admin
    .from("organizations")
    .update({ logo_url: url })
    .eq("id", ctx.organization.id);
  if (updateErr) return { error: `DB update failed: ${updateErr.message}` };

  await invalidateTenantCacheForOrg(ctx.organization.id);
  await invalidateStaffLocationCacheForOrg(ctx.organization.id);
  revalidatePath("/staff/settings");
  revalidatePath("/staff", "layout");
  return { success: true, url };
}

export async function removeOrgLogo(): Promise<{ error: string } | { success: true }> {
  const ctx = await requireStaffContext();
  if (ctx.orgRole !== "owner" && ctx.orgRole !== "admin") {
    return { error: "Only owners and admins can remove the logo." };
  }

  const admin = createAdminClient();

  // Remove all files under this org's folder (don't bother listing/deleting individually)
  const { data: files } = await admin.storage.from(BUCKET).list(ctx.organization.id);
  if (files && files.length) {
    await admin.storage
      .from(BUCKET)
      .remove(files.map((f) => `${ctx.organization.id}/${f.name}`));
  }

  const { error } = await admin
    .from("organizations")
    .update({ logo_url: null })
    .eq("id", ctx.organization.id);
  if (error) return { error: error.message };

  await invalidateTenantCacheForOrg(ctx.organization.id);
  await invalidateStaffLocationCacheForOrg(ctx.organization.id);
  revalidatePath("/staff/settings");
  revalidatePath("/staff", "layout");
  return { success: true };
}
