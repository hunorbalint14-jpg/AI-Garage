import { createAdminClient } from "@/lib/supabase/admin";

export const QUOTE_VIDEO_BUCKET = "job-quote-videos";
export const QUOTE_VIDEO_MAX_BYTES = 80 * 1024 * 1024; // 80 MB
export const QUOTE_VIDEO_ALLOWED_MIME = [
  "video/mp4",
  "video/quicktime", // iOS .mov
  "video/webm",
] as const;

export function isAllowedVideoMime(mime: string): boolean {
  return (QUOTE_VIDEO_ALLOWED_MIME as readonly string[]).includes(mime);
}

export function videoPath(locationId: string, jobId: string, quoteId: string, ext: string): string {
  // Sanitise ext to letters only and lowercase.
  const cleanExt = ext.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 5) || "mp4";
  return `${locationId}/${jobId}/${quoteId}.${cleanExt}`;
}

// Mint a signed PUT URL for direct client → Supabase Storage upload, bypassing
// the Next.js server-action body limit. The client PUTs the raw file bytes.
export async function createUploadUrl(path: string): Promise<{ url: string; token: string } | { error: string }> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(QUOTE_VIDEO_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data) return { error: error?.message ?? "Failed to mint upload URL." };
  return { url: data.signedUrl, token: data.token };
}

// Short-TTL signed read URL for the customer-facing /quote/[slug] page.
export async function createSignedReadUrl(path: string, expiresInSeconds = 1800): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(QUOTE_VIDEO_BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error || !data) return null;
  return data.signedUrl;
}

// Verify the object actually exists at the path (called server-side after
// the client confirms upload completion, before we trust video_path).
export async function videoObjectExists(path: string): Promise<boolean> {
  const admin = createAdminClient();
  const folder = path.substring(0, path.lastIndexOf("/"));
  const name = path.substring(path.lastIndexOf("/") + 1);
  const { data, error } = await admin.storage
    .from(QUOTE_VIDEO_BUCKET)
    .list(folder, { search: name, limit: 1 });
  if (error) return false;
  return !!data?.some((f) => f.name === name);
}

export async function removeVideoObject(path: string): Promise<void> {
  const admin = createAdminClient();
  try {
    await admin.storage.from(QUOTE_VIDEO_BUCKET).remove([path]);
  } catch (err) {
    console.error("[quote-storage] remove failed", { path, err });
  }
}
