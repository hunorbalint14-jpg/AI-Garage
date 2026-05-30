import { createHmac, randomBytes } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeEqual } from "@/lib/safe-equal";

// Signed, time-limited, single-use password-reset token. Issued by the auth
// callback after Supabase verifies the reset email, consumed by the
// reset-password action. Centralising sign + verify here keeps the secret and
// payload format from drifting between the two call sites.
//
// Format: base64url(JSON{ uid, ts, jti, sig }), sig = HMAC-SHA256("uid:ts:jti").
// Single-use is enforced by inserting `jti` into password_reset_tokens on
// consume; a replay hits the PK conflict and is rejected.

const RESET_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

// Dedicated secret, separate from CRON_SECRET. Falls back to CRON_SECRET only
// if unset so the feature works before the new env var is provisioned.
function secret(): string {
  return (
    process.env.RESET_TOKEN_SECRET ??
    process.env.CRON_SECRET ??
    "dev-reset-secret"
  );
}

function sign(uid: string, ts: string, jti: string): string {
  return createHmac("sha256", secret()).update(`${uid}:${ts}:${jti}`).digest("hex");
}

export function signResetToken(userId: string): string {
  const ts = Date.now().toString();
  const jti = randomBytes(16).toString("hex");
  const sig = sign(userId, ts, jti);
  return Buffer.from(JSON.stringify({ uid: userId, ts, jti, sig })).toString("base64url");
}

// Verifies signature + expiry, then atomically marks the token consumed.
// Returns the user id on the first valid use; null if malformed, expired,
// tampered, or already used.
export async function consumeResetToken(
  token: string,
): Promise<{ uid: string } | null> {
  let uid: string, ts: string, jti: string, sig: string;
  try {
    ({ uid, ts, jti, sig } = JSON.parse(Buffer.from(token, "base64url").toString()));
  } catch {
    return null;
  }
  if (!uid || !ts || !jti || !sig) return null;

  const issuedAt = parseInt(ts, 10);
  if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > RESET_EXPIRY_MS) return null;
  if (!safeEqual(sig, sign(uid, ts, jti))) return null;

  // Record the jti — the unique PK makes this the single-use gate.
  const admin = createAdminClient();
  const { error } = await admin.from("password_reset_tokens").insert({
    jti,
    user_id: uid,
    expires_at: new Date(issuedAt + RESET_EXPIRY_MS).toISOString(),
  });
  if (error) return null; // 23505 (already used) or any write failure → reject

  return { uid };
}
