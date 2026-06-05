import crypto from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

// Plan-invite token gating. Mirrors the quote-link model (quote-links.ts): a
// random 32-byte token shown only in the generated link; the DB stores only the
// sha256 hash. The customer route is /plan/{slug}?t={token}, slug prefixed "pi-".

export type PlanInviteVerifyReason = "not_found" | "bad_token" | "expired" | "wrong_status";

export type PlanInviteRecord = {
  id: string;
  location_id: string;
  service_plan_id: string;
  customer_id: string | null;
  status: string;
  expires_at: string;
};

export type PlanInviteVerifyResult =
  | { ok: true; invite: PlanInviteRecord }
  | { ok: false; reason: PlanInviteVerifyReason };

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

export function generatePlanInviteToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function generatePlanInviteSlug(): string {
  return `pi-${crypto.randomBytes(5).toString("hex")}`;
}

export function hashPlanInviteToken(token: string): string {
  return hashToken(token);
}

// Look up an invite by slug and verify the raw token against the stored hash.
export async function verifyPlanInviteAccess(
  slug: string,
  rawToken: string | null,
  allowedStatuses: string[] = ["pending"],
): Promise<PlanInviteVerifyResult> {
  if (!rawToken || rawToken.length < 16) {
    return { ok: false, reason: "bad_token" };
  }
  if (!slug.startsWith("pi-")) {
    return { ok: false, reason: "not_found" };
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("plan_invites")
    .select("id, location_id, service_plan_id, customer_id, status, expires_at, token_hash")
    .eq("slug", slug)
    .maybeSingle();

  if (error || !data) return { ok: false, reason: "not_found" };

  const row = data as {
    id: string;
    location_id: string;
    service_plan_id: string;
    customer_id: string | null;
    status: string;
    expires_at: string | null;
    token_hash: string | null;
  };

  if (!row.token_hash || !constantTimeEqualHex(hashToken(rawToken), row.token_hash)) {
    return { ok: false, reason: "bad_token" };
  }
  if (!row.expires_at || new Date(row.expires_at) <= new Date()) {
    return { ok: false, reason: "expired" };
  }
  if (!allowedStatuses.includes(row.status)) {
    return { ok: false, reason: "wrong_status" };
  }

  return {
    ok: true,
    invite: {
      id: row.id,
      location_id: row.location_id,
      service_plan_id: row.service_plan_id,
      customer_id: row.customer_id,
      status: row.status,
      expires_at: row.expires_at,
    },
  };
}

// Build a tenant-aware invite URL: https://{slug}.{rootHost}/plan/{inviteSlug}?t={token}
export function tenantPlanInviteUrl(tenantSlug: string, inviteSlug: string, token: string): string {
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "ai-garage.co.uk";
  const isLocal = rootDomain.includes("localtest") || rootDomain.includes("localhost");
  const proto = isLocal ? "http" : "https";
  return `${proto}://${tenantSlug}.${rootDomain}/plan/${inviteSlug}?t=${token}`;
}
