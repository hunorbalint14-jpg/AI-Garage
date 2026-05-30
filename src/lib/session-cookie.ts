// HMAC-signs the absolute session-timeout stamp (`ai_session_started_at`) so a
// user cannot edit the cookie to push their session start forward and dodge the
// 12-hour cap. Uses Web Crypto (not node:crypto) because the proxy/middleware
// runs in the Edge runtime. A tampered or legacy-unsigned value reads back as
// null and the caller treats it as expired.
//
// Note: deleting the cookie still re-stamps a fresh window — fully closing that
// requires a server-authoritative start time (tracked as a Phase-4 follow-up).

const enc = new TextEncoder();

function secret(): string {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Constant-time string compare (Edge-safe, no node:crypto).
function ctEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sign(ts: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(ts)));
}

export async function makeSessionStartValue(nowMs: number): Promise<string> {
  const ts = String(nowMs);
  return `${ts}.${await sign(ts)}`;
}

// Returns the start timestamp (ms) when the cookie is present AND validly
// signed; null when absent, malformed, legacy-unsigned, or tampered.
export async function readSessionStart(
  raw: string | undefined | null,
): Promise<number | null> {
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;
  const ts = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  if (!ctEqual(sig, await sign(ts))) return null;
  const n = parseInt(ts, 10);
  return Number.isFinite(n) ? n : null;
}
