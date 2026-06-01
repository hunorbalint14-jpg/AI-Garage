import crypto from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

// Post-job review tokens. A review_requests row is created (queued, tokenless)
// when a job completes; the send cron mints a random 32-byte token, stores only
// its sha256 hash, and emails the customer /review/[token]. The raw token is
// never persisted — same hash-only approach as quote-links.ts.

export type ReviewVerifyReason = "not_found" | "bad_token" | "already_responded";

export type ReviewRecord = {
  id: string;
  location_id: string;
  organization_id: string | null;
  job_id: string;
  customer_id: string | null;
  status: string;
  score: number | null;
};

export type ReviewVerifyResult =
  | { ok: true; review: ReviewRecord }
  | { ok: false; reason: ReviewVerifyReason };

export function generateReviewToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashReviewToken(token: string): string {
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

// Tenant-aware review URL: https://{slug}.{rootHost}/review/{token}
export function tenantReviewUrl(tenantSlug: string, token: string): string {
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "ai-garage.co.uk";
  const isLocal = rootDomain.includes("localtest") || rootDomain.includes("localhost");
  const proto = isLocal ? "http" : "https";
  return `${proto}://${tenantSlug}.${rootDomain}/review/${token}`;
}

// Create a queued review request for a completed job. Fire-and-forget — never
// throws into the caller. Skips when there's no customer email, or a request
// already exists for this job (one ask per job).
export async function enqueueReviewRequest(args: {
  jobId: string;
  locationId: string;
  organizationId: string | null;
  customerId: string | null;
  customerEmail: string | null;
}): Promise<void> {
  try {
    if (!args.customerId || !args.customerEmail) return;
    const admin = createAdminClient();

    const { data: existing } = await admin
      .from("review_requests")
      .select("id")
      .eq("job_id", args.jobId)
      .maybeSingle();
    if (existing) return;

    await admin.from("review_requests").insert({
      location_id: args.locationId,
      organization_id: args.organizationId,
      job_id: args.jobId,
      customer_id: args.customerId,
      status: "queued",
    });
  } catch (err) {
    console.error("[review-links] enqueue failed", err);
  }
}

// Look up a review request by raw token (constant-time hash compare). Used by
// the public /review/[token] page + submit action.
export async function verifyReviewAccess(rawToken: string | null): Promise<ReviewVerifyResult> {
  if (!rawToken || rawToken.length < 16) return { ok: false, reason: "bad_token" };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("review_requests")
    .select("id, location_id, organization_id, job_id, customer_id, status, score, token_hash")
    .eq("token_hash", hashReviewToken(rawToken))
    .maybeSingle();

  if (error || !data) return { ok: false, reason: "not_found" };
  const row = data as ReviewRecord & { token_hash: string | null };

  // Defence-in-depth: the eq() already matched the hash, but compare in constant
  // time too.
  if (!row.token_hash || !constantTimeEqualHex(hashReviewToken(rawToken), row.token_hash)) {
    return { ok: false, reason: "bad_token" };
  }
  if (row.status === "responded") return { ok: false, reason: "already_responded" };

  return {
    ok: true,
    review: {
      id: row.id,
      location_id: row.location_id,
      organization_id: row.organization_id,
      job_id: row.job_id,
      customer_id: row.customer_id,
      status: row.status,
      score: row.score,
    },
  };
}
