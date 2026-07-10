import { createAdminClient } from "@/lib/supabase/admin";

// Work authorisation helpers (#503). The artefact row is the legal record —
// items and terms are snapshotted as shown; these helpers keep the maths and
// storage recipes in one place.

// Pure maths + types live in work-auth-shared.ts (client-importable);
// re-exported here so server callers keep one import path.
export * from "@/lib/work-auth-shared";

export const SIGNATURE_BUCKET = "authorisation-signatures";
export const SIGNATURE_MAX_BYTES = 200 * 1024; // canvas PNGs are ~10–50 KB

export function signaturePath(locationId: string, jobId: string, authId: string): string {
  return `${locationId}/${jobId}/${authId}.png`;
}

export async function createSignatureReadUrl(path: string, expiresInSeconds = 1800): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin.storage.from(SIGNATURE_BUCKET).createSignedUrl(path, expiresInSeconds);
  return data?.signedUrl ?? null;
}

export type LatestAuthorisation = {
  id: string;
  kind: string;
  method: string;
  status: string;
  authorised_total: number;
  signed_name: string | null;
  authorised_at: string | null;
} | null;

// Newest AUTHORISED artefact for a job — what the variation check (PR 4) and
// the job-card chip compare against.
export async function latestAuthorisation(
  admin: ReturnType<typeof createAdminClient>,
  jobId: string,
): Promise<LatestAuthorisation> {
  const { data } = await admin
    .from("work_authorisations")
    .select("id, kind, method, status, authorised_total, signed_name, authorised_at")
    .eq("job_id", jobId)
    .eq("status", "authorised")
    .order("authorised_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  return (data as LatestAuthorisation) ?? null;
}

// Decode a canvas PNG data URL by hand — never fetch(dataUrl), the CSP
// connect-src trap. Returns null unless it's a plausible small PNG.
export function decodeSignatureDataUrl(dataUrl: string): Buffer | null {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());
  if (!m) return null;
  try {
    const buf = Buffer.from(m[1], "base64");
    if (buf.length === 0 || buf.length > SIGNATURE_MAX_BYTES) return null;
    // PNG magic bytes.
    if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return null;
    return buf;
  } catch {
    return null;
  }
}
