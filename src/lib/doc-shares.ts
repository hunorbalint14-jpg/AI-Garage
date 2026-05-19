import crypto from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

// Shareable signed-link doc gates. Tokens are random 32-byte values shown to
// the staff user once on creation; the database only stores a sha256 hash.
// Lookups are by hash (indexed), and the hash compare itself is constant-time.

export type DocShare = {
  id: string;
  slug: string;
  doc_key: string;
  label: string | null;
  expires_at: string | null;
  max_views: number | null;
  view_count: number;
  organization_id: string | null;
  created_by: string | null;
  created_at: string;
  revoked_at: string | null;
  revoked_by: string | null;
  last_viewed_at: string | null;
};

export type VerifyReason =
  | "not_found"
  | "bad_token"
  | "revoked"
  | "expired"
  | "exhausted";

export type VerifyResult =
  | { ok: true; share: DocShare }
  | { ok: false; reason: VerifyReason };

// --- token primitives -------------------------------------------------------

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

export function generateToken(): string {
  // 32 random bytes → base64url ≈ 43 chars. URL-safe, no padding.
  return crypto.randomBytes(32).toString("base64url");
}

function generateSlug(docKey: string): string {
  // <docKey>-<8 hex> — readable but not guessable.
  const suffix = crypto.randomBytes(4).toString("hex");
  return `${docKey}-${suffix}`;
}

// --- queries ---------------------------------------------------------------

export async function verifyShareAccess(
  slug: string,
  rawToken: string | null,
): Promise<VerifyResult> {
  if (!rawToken || rawToken.length < 16) {
    return { ok: false, reason: "bad_token" };
  }

  const admin = createAdminClient();
  const { data } = await admin
    .from("doc_shares")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  if (!data) return { ok: false, reason: "not_found" };
  const share = data as DocShare & { token_hash: string };

  if (!constantTimeEqualHex(hashToken(rawToken), share.token_hash)) {
    return { ok: false, reason: "bad_token" };
  }
  if (share.revoked_at) return { ok: false, reason: "revoked" };
  if (share.expires_at && new Date(share.expires_at) <= new Date()) {
    return { ok: false, reason: "expired" };
  }
  if (share.max_views !== null && share.view_count >= share.max_views) {
    return { ok: false, reason: "exhausted" };
  }

  // Strip token_hash from the returned object so it never leaves this module.
  const { token_hash: _omit, ...safe } = share;
  void _omit;
  return { ok: true, share: safe as DocShare };
}

// Fire-and-forget — the route handler awaits this but a network error here
// should never block the doc render. Caller can ignore the return.
export async function recordView(shareId: string): Promise<void> {
  const admin = createAdminClient();
  try {
    await admin.rpc("doc_shares_increment_view", { p_id: shareId });
  } catch (err) {
    console.error("[doc-shares] recordView failed", err);
  }
}

export async function listShares(args: {
  organizationId: string | null;
  includePlatform?: boolean;
}): Promise<DocShare[]> {
  const admin = createAdminClient();
  let q = admin
    .from("doc_shares")
    .select(
      "id, slug, doc_key, label, expires_at, max_views, view_count, organization_id, created_by, created_at, revoked_at, revoked_by, last_viewed_at",
    )
    .order("created_at", { ascending: false });

  if (args.includePlatform && args.organizationId) {
    q = q.or(`organization_id.eq.${args.organizationId},organization_id.is.null`);
  } else if (args.organizationId) {
    q = q.eq("organization_id", args.organizationId);
  } else {
    q = q.is("organization_id", null);
  }

  const { data, error } = await q;
  if (error) {
    console.error("[doc-shares] listShares failed", error);
    return [];
  }
  return (data ?? []) as DocShare[];
}

// --- mutations -------------------------------------------------------------

export type CreateShareInput = {
  docKey: string;
  label: string | null;
  expiresAt: Date | null;
  maxViews: number | null;
  organizationId: string | null;
  createdBy: string | null;
};

export type CreateShareResult = {
  share: DocShare;
  token: string; // raw, shown to the user ONCE
};

export async function createShare(input: CreateShareInput): Promise<CreateShareResult> {
  const admin = createAdminClient();
  const token = generateToken();
  const tokenHash = hashToken(token);
  const slug = generateSlug(input.docKey);

  const { data, error } = await admin
    .from("doc_shares")
    .insert({
      slug,
      doc_key: input.docKey,
      token_hash: tokenHash,
      label: input.label,
      expires_at: input.expiresAt?.toISOString() ?? null,
      max_views: input.maxViews,
      organization_id: input.organizationId,
      created_by: input.createdBy,
    })
    .select(
      "id, slug, doc_key, label, expires_at, max_views, view_count, organization_id, created_by, created_at, revoked_at, revoked_by, last_viewed_at",
    )
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to create share");
  }
  return { share: data as DocShare, token };
}

export async function revokeShare(args: {
  id: string;
  revokedBy: string | null;
  organizationId: string | null;
}): Promise<void> {
  const admin = createAdminClient();
  let q = admin
    .from("doc_shares")
    .update({ revoked_at: new Date().toISOString(), revoked_by: args.revokedBy })
    .eq("id", args.id);
  // Scope the update so an org owner can't revoke another org's shares.
  if (args.organizationId) q = q.eq("organization_id", args.organizationId);
  else q = q.is("organization_id", null);
  const { error } = await q;
  if (error) throw new Error(error.message);
}

// Build the absolute share URL. Honours custom domains via NEXT_PUBLIC_ROOT_DOMAIN
// in production. The token is the *raw* token returned from createShare().
export function shareUrl(rootDomain: string, slug: string, token: string): string {
  const isLocal = rootDomain.includes("localtest.me") || rootDomain.includes("localhost");
  const proto = isLocal ? "http" : "https";
  // Strip any port-only suffix on the root domain when building the URL —
  // ports come back automatically for the local dev case via the host string.
  return `${proto}://${rootDomain}/docs/${slug}?t=${token}`;
}
