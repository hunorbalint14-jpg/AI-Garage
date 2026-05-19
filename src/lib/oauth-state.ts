import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Stateless OAuth state-param signer/verifier. Lets us identify the user
// + org that initiated an OAuth flow in the callback handler without
// relying on a session cookie — necessary because callbacks land on the
// apex domain but user sessions live on tenant subdomains.
//
// State format: <payloadB64>.<sigB64>
//   payload = JSON { orgId, userId, exp (unix seconds), nonce }
//   sig     = HMAC-SHA256(payload, secret)

const STATE_TTL_SECONDS = 10 * 60; // 10 min — Xero consent screen rarely takes longer

function secret(): Buffer {
  const raw = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!raw) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY missing — required to sign OAuth state.",
    );
  }
  // Hash to a fixed-size key.
  return Buffer.from(raw, "utf8");
}

function b64urlEncode(buf: Buffer | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf, "utf8") : buf;
  return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

export function signOAuthState(args: { orgId: string; userId: string }): string {
  const payload = {
    orgId: args.orgId,
    userId: args.userId,
    exp: Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS,
    nonce: randomBytes(8).toString("hex"),
  };
  const payloadB64 = b64urlEncode(JSON.stringify(payload));
  const sig = createHmac("sha256", secret()).update(payloadB64).digest();
  return `${payloadB64}.${b64urlEncode(sig)}`;
}

export type VerifiedOAuthState =
  | { ok: true; orgId: string; userId: string }
  | { ok: false; reason: "malformed" | "bad-sig" | "expired" };

export function verifyOAuthState(state: string): VerifiedOAuthState {
  const parts = state.split(".");
  if (parts.length !== 2) return { ok: false, reason: "malformed" };
  const [payloadB64, sigB64] = parts;
  const expectedSig = createHmac("sha256", secret()).update(payloadB64).digest();
  const providedSig = b64urlDecode(sigB64);
  if (
    expectedSig.length !== providedSig.length ||
    !timingSafeEqual(expectedSig, providedSig)
  ) {
    return { ok: false, reason: "bad-sig" };
  }
  let payload: { orgId: string; userId: string; exp: number };
  try {
    payload = JSON.parse(b64urlDecode(payloadB64).toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!payload.orgId || !payload.userId || !payload.exp) {
    return { ok: false, reason: "malformed" };
  }
  if (payload.exp < Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, orgId: payload.orgId, userId: payload.userId };
}
