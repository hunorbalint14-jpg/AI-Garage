import crypto from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

// eVHC report token gating (#497 Phase 5). Same recipe as quote-links: the
// customer report at /check/[slug]?t=... is public but unguessable — a random
// 32-byte token whose sha256 is the only thing stored. Slug prefix "hc-"
// keeps the namespace distinct from quotes ("q-"/"sq-").

export type CheckVerifyReason = "not_found" | "bad_token" | "wrong_status";

export type CheckRecord = {
  id: string;
  location_id: string;
  job_id: string;
  quote_id: string | null;
  status: string;
};

export type CheckVerifyResult =
  | { ok: true; inspection: CheckRecord }
  | { ok: false; reason: CheckVerifyReason };

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

function constantTimeEqualHex(a: string, b: string): boolean {
  try {
    const aBuf = Buffer.from(a, "hex");
    const bBuf = Buffer.from(b, "hex");
    if (aBuf.length !== bBuf.length || aBuf.length === 0) return false;
    return crypto.timingSafeEqual(aBuf, bBuf);
  } catch {
    return false;
  }
}

export function generateCheckToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function generateCheckSlug(): string {
  return `hc-${crypto.randomBytes(5).toString("hex")}`;
}

export function hashCheckToken(token: string): string {
  return hashToken(token);
}

// Reports don't expire (unlike quotes — the linked quote carries its own
// expiry); access is gated on the token + the inspection having been sent.
export async function verifyCheckAccess(
  slug: string,
  rawToken: string | null,
  allowedStatuses: string[] = ["sent"],
): Promise<CheckVerifyResult> {
  if (!rawToken || rawToken.length < 16) return { ok: false, reason: "bad_token" };
  if (!slug.startsWith("hc-")) return { ok: false, reason: "not_found" };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("inspections")
    .select("id, location_id, job_id, quote_id, status, token_hash")
    .eq("slug", slug)
    .maybeSingle();
  if (error || !data) return { ok: false, reason: "not_found" };
  const row = data as CheckRecord & { token_hash: string | null };

  if (!row.token_hash || !constantTimeEqualHex(hashToken(rawToken), row.token_hash)) {
    return { ok: false, reason: "bad_token" };
  }
  if (!allowedStatuses.includes(row.status)) return { ok: false, reason: "wrong_status" };

  return {
    ok: true,
    inspection: {
      id: row.id,
      location_id: row.location_id,
      job_id: row.job_id,
      quote_id: row.quote_id,
      status: row.status,
    },
  };
}

// https://{orgSlug}.{rootHost}/check/{slug}?t={token} — org slug only, the
// tenant subdomain resolves the organisation.
export function tenantCheckUrl(orgSlug: string, checkSlug: string, token: string): string {
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "ai-garage.co.uk";
  const isLocal = rootDomain.includes("localtest") || rootDomain.includes("localhost");
  const proto = isLocal ? "http" : "https";
  return `${proto}://${orgSlug}.${rootDomain}/check/${checkSlug}?t=${token}`;
}
