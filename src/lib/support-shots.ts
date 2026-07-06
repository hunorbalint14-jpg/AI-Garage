import { createAdminClient } from "@/lib/supabase/admin";

// Storage helpers for support-ticket screenshots. Mirrors quote-storage.ts:
// private bucket, no storage policies (absence denies), all access through
// service-role signed URLs. The widget captures a PNG client-side, PUTs it to
// a signed upload URL, and the ticket context stores only the object path.

export { SUPPORT_SHOT_BUCKET, SUPPORT_SHOT_MAX_BYTES } from "./support-shots-shared";
import { SUPPORT_SHOT_BUCKET } from "./support-shots-shared";

// One folder per org so a forged path can be rejected by prefix server-side.
export function shotPath(organizationId: string): string {
  return `${organizationId}/${crypto.randomUUID()}.png`;
}

// Mint a signed PUT URL for direct client → Supabase Storage upload.
export async function createShotUploadUrl(
  path: string,
): Promise<{ url: string; token: string } | { error: string }> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(SUPPORT_SHOT_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data) return { error: error?.message ?? "Failed to mint upload URL." };
  return { url: data.signedUrl, token: data.token };
}

// Short-TTL signed read URL for the admin ticket detail.
export async function createShotSignedReadUrl(
  path: string,
  expiresInSeconds = 1800,
): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(SUPPORT_SHOT_BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error || !data) return null;
  return data.signedUrl;
}

// Verify the object exists before trusting a client-supplied path.
export async function shotObjectExists(path: string): Promise<boolean> {
  const admin = createAdminClient();
  const folder = path.substring(0, path.lastIndexOf("/"));
  const name = path.substring(path.lastIndexOf("/") + 1);
  const { data, error } = await admin.storage
    .from(SUPPORT_SHOT_BUCKET)
    .list(folder, { search: name, limit: 1 });
  if (error) return false;
  return !!data?.some((f) => f.name === name);
}
