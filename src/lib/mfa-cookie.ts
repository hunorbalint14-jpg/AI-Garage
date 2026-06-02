// HMAC-signs the per-session MFA-verified marker (`ai_mfa_verified`). The value
// binds the user id so a cookie from one account can't be replayed for another,
// and carries a timestamp so it expires with the session (12h, same cap as the
// session-start cookie). Uses Web Crypto (not node:crypto) so it works in the
// Edge runtime too. A tampered / legacy / expired value reads back as null.
//
// Mirrors src/lib/session-cookie.ts.

const enc = new TextEncoder();
const MAX_MFA_MS = 12 * 60 * 60 * 1000; // 12 hours

export const MFA_COOKIE = "ai_mfa_verified";

function secret(): string {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function ctEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sign(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(payload)));
}

export async function makeMfaValue(userId: string, nowMs: number): Promise<string> {
  // userId is a uuid (no '|'); ts is digits — '|' separates them safely.
  const payload = `${userId}|${nowMs}`;
  return `${payload}.${await sign(payload)}`;
}

// Returns the verified user id when the cookie is present, validly signed and
// not older than the 12h cap; null otherwise.
export async function readMfaUser(raw: string | undefined | null): Promise<string | null> {
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  if (!ctEqual(sig, await sign(payload))) return null;

  const bar = payload.indexOf("|");
  if (bar <= 0) return null;
  const userId = payload.slice(0, bar);
  const ts = parseInt(payload.slice(bar + 1), 10);
  if (!Number.isFinite(ts) || Date.now() - ts > MAX_MFA_MS) return null;
  return userId;
}
