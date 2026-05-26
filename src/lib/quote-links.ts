import crypto from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

// DVI quote links. Tokens are random 32-byte values shown only via the
// generated link; the DB only stores their sha256 hash. Mirrors doc-shares.ts.

export type QuoteVerifyReason =
  | "not_found"
  | "bad_token"
  | "expired"
  | "wrong_status";

export type QuoteRecord = {
  id: string;
  job_id: string;
  location_id: string;
  status: string;
  expires_at: string;
};

export type QuoteVerifyResult =
  | { ok: true; quote: QuoteRecord }
  | { ok: false; reason: QuoteVerifyReason };

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

export function generateQuoteToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function generateQuoteSlug(): string {
  return `q-${crypto.randomBytes(5).toString("hex")}`;
}

export function hashQuoteToken(token: string): string {
  return hashToken(token);
}

// Lookup by slug + verify the raw token against the stored hash.
// `allowedStatuses` defaults to ["pending"] for the customer landing page;
// outcome pages pass the appropriate value so refresh-after-approve works.
export async function verifyQuoteAccess(
  slug: string,
  rawToken: string | null,
  allowedStatuses: string[] = ["pending"],
): Promise<QuoteVerifyResult> {
  if (!rawToken || rawToken.length < 16) {
    console.log("[verifyQuoteAccess] bad_token (length)", { slug, tokenLen: rawToken?.length ?? 0 });
    return { ok: false, reason: "bad_token" };
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("job_quotes")
    .select("id, job_id, location_id, status, expires_at, token_hash, slug")
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    console.error("[verifyQuoteAccess] db error", { slug, error: error.message, code: error.code });
    return { ok: false, reason: "not_found" };
  }
  if (!data) {
    console.warn("[verifyQuoteAccess] no row for slug", { slug });
    return { ok: false, reason: "not_found" };
  }
  const row = data as QuoteRecord & { token_hash: string; slug: string };

  if (!constantTimeEqualHex(hashToken(rawToken), row.token_hash)) {
    console.warn("[verifyQuoteAccess] token hash mismatch", { slug, expectedSlug: row.slug, status: row.status });
    return { ok: false, reason: "bad_token" };
  }
  if (new Date(row.expires_at) <= new Date()) {
    console.warn("[verifyQuoteAccess] expired", { slug, expires_at: row.expires_at });
    return { ok: false, reason: "expired" };
  }
  if (!allowedStatuses.includes(row.status)) {
    console.warn("[verifyQuoteAccess] wrong_status", { slug, status: row.status, allowed: allowedStatuses });
    return { ok: false, reason: "wrong_status" };
  }

  const { token_hash: _omit, ...safe } = row;
  void _omit;
  return { ok: true, quote: safe as QuoteRecord };
}

// Build a tenant-aware quote URL: https://{slug}.{rootHost}/quote/{quoteSlug}?t={token}
export function tenantQuoteUrl(
  tenantSlug: string,
  quoteSlug: string,
  token: string,
): string {
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "ai-garage.co.uk";
  const isLocal = rootDomain.includes("localtest") || rootDomain.includes("localhost");
  const proto = isLocal ? "http" : "https";
  return `${proto}://${tenantSlug}.${rootDomain}/quote/${quoteSlug}?t=${token}`;
}
