import { createAdminClient } from "@/lib/supabase/admin";

// eVHC finding photos (#497). Same model as courtesy-car photos: private
// bucket, signed PUT for direct client → storage upload (server-action bodies
// are too small for photos), short-TTL signed reads, server-side existence
// check before a path is trusted into the DB.

export const INSPECTION_MEDIA_BUCKET = "inspection-media";
export const INSPECTION_PHOTO_MAX_BYTES = 10 * 1024 * 1024; // 10 MB each
export const INSPECTION_PHOTO_MAX_COUNT = 4; // per finding
export const INSPECTION_PHOTO_ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"] as const;

export function isAllowedInspectionMime(mime: string): boolean {
  return (INSPECTION_PHOTO_ALLOWED_MIME as readonly string[]).includes(mime);
}

export function inspectionPhotoPath(
  locationId: string,
  inspectionId: string,
  itemId: string,
  mime: string,
): string {
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  return `${locationId}/${inspectionId}/${itemId}/${Date.now()}.${ext}`;
}

export async function createInspectionUploadUrl(
  path: string,
): Promise<{ url: string } | { error: string }> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(INSPECTION_MEDIA_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data) return { error: error?.message ?? "Failed to mint upload URL." };
  return { url: data.signedUrl };
}

export async function inspectionMediaExists(path: string): Promise<boolean> {
  const admin = createAdminClient();
  const folder = path.split("/").slice(0, -1).join("/");
  const name = path.split("/").pop()!;
  const { data } = await admin.storage.from(INSPECTION_MEDIA_BUCKET).list(folder, { search: name });
  return (data ?? []).some((o) => o.name === name);
}

// One batched call for every photo on the page.
export async function createInspectionReadUrls(
  paths: string[],
  expiresInSeconds = 1800,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (paths.length === 0) return out;
  const admin = createAdminClient();
  const { data } = await admin.storage
    .from(INSPECTION_MEDIA_BUCKET)
    .createSignedUrls(paths, expiresInSeconds);
  for (const row of data ?? []) {
    if (row.signedUrl && row.path) out.set(row.path, row.signedUrl);
  }
  return out;
}

export async function deleteInspectionMediaObject(path: string): Promise<void> {
  const admin = createAdminClient();
  await admin.storage.from(INSPECTION_MEDIA_BUCKET).remove([path]);
}
