import { createAdminClient } from "@/lib/supabase/admin";

// Condition photos for courtesy car loans. Same model as quote-storage:
// private bucket, signed PUT for upload, short-TTL signed reads, server-side
// existence check before a path is trusted.

export const COURTESY_PHOTO_BUCKET = "courtesy-car-photos";
export const COURTESY_PHOTO_MAX_BYTES = 10 * 1024 * 1024; // 10 MB each
export const COURTESY_PHOTO_MAX_COUNT = 6; // per direction
export const COURTESY_PHOTO_ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"] as const;

export function isAllowedPhotoMime(mime: string): boolean {
  return (COURTESY_PHOTO_ALLOWED_MIME as readonly string[]).includes(mime);
}

export function loanPhotoPath(
  locationId: string,
  loanId: string,
  direction: "out" | "in",
  index: number,
  ext: string,
): string {
  const cleanExt = ext.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 5) || "jpg";
  return `${locationId}/${loanId}/${direction}-${index}-${Date.now()}.${cleanExt}`;
}

export async function createPhotoUploadUrl(
  path: string,
): Promise<{ url: string } | { error: string }> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(COURTESY_PHOTO_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data) return { error: error?.message ?? "Failed to mint upload URL." };
  return { url: data.signedUrl };
}

export async function photoExists(path: string): Promise<boolean> {
  const admin = createAdminClient();
  const folder = path.split("/").slice(0, -1).join("/");
  const name = path.split("/").pop()!;
  const { data } = await admin.storage.from(COURTESY_PHOTO_BUCKET).list(folder, { search: name });
  return (data ?? []).some((o) => o.name === name);
}

// One batched call for every photo on the page.
export async function createPhotoReadUrls(
  paths: string[],
  expiresInSeconds = 1800,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (paths.length === 0) return out;
  const admin = createAdminClient();
  const { data } = await admin.storage
    .from(COURTESY_PHOTO_BUCKET)
    .createSignedUrls(paths, expiresInSeconds);
  for (const row of data ?? []) {
    if (row.signedUrl && row.path) out.set(row.path, row.signedUrl);
  }
  return out;
}
