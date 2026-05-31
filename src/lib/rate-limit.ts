import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { headers } from "next/headers";

// Sliding-window rate limiting for auth surfaces, backed by Upstash Redis.
//
// Design choices:
//  - DISABLED when UPSTASH_REDIS_REST_URL/TOKEN are unset (local dev, and any
//    environment not yet provisioned). The limiter then allows every request so
//    nothing breaks before Upstash is wired up.
//  - FAIL-OPEN: if Upstash is configured but unreachable, we log and allow. An
//    auth outage must not lock every user out; Supabase GoTrue keeps its own
//    backstop limits. (Flip a specific bucket to fail-closed only if its abuse
//    risk outweighs the availability hit.)
//  - Buckets count ATTEMPTS, not failures — a brute-force run burns the budget
//    regardless of whether each guess succeeds, and a normal login costs 1.

// Accept both our own names and the ones Vercel's Upstash Marketplace
// integration injects (`UPSTASH_KV_REST_API_*`), so the limiter activates
// whichever way the DB was provisioned. The Redis client needs the REST URL +
// token — not `UPSTASH_REDIS_URL`, which is the redis:// TCP string.
const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.UPSTASH_KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.UPSTASH_KV_REST_API_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;

// A deployed environment with no Upstash config means auth is silently
// unthrottled — make that loud. One line per cold start (module load), not
// per request. Local dev (no VERCEL_ENV) stays quiet: the no-op is intentional.
if (!redis && (process.env.VERCEL_ENV || process.env.NODE_ENV === "production")) {
  console.warn(
    "[rate-limit] DISABLED — UPSTASH_REDIS_REST_URL/TOKEN (or UPSTASH_KV_REST_API_*) unset. Auth endpoints are NOT throttled.",
  );
}

type Window = Parameters<typeof Ratelimit.slidingWindow>[1];

function makeLimiter(prefix: string, tokens: number, window: Window): Ratelimit | null {
  if (!redis) return null;
  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(tokens, window),
    prefix: `rl:${prefix}`,
    analytics: false,
  });
}

// Tunables. Login is per IP+email so one attacker can't lock out a victim by
// hammering their email from elsewhere, yet a single IP is still throttled.
const LIMITERS = {
  // Password sign-in / passkey: 8 attempts per minute per key.
  login: makeLimiter("login", 8, "60 s"),
  // Outbound auth emails (reset link, magic link): 4 per hour per key.
  email: makeLimiter("email", 4, "3600 s"),
  // Token bridge (set-session): looser, per IP.
  token: makeLimiter("token", 20, "60 s"),
} as const;

export type RateLimitBucket = keyof typeof LIMITERS;

export type RateLimitResult = { ok: true } | { ok: false; retryAfter: number };

// Best-effort client IP from the proxy chain. Vercel sets x-forwarded-for.
export async function clientIp(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return h.get("x-real-ip")?.trim() || "unknown";
}

// Enforce a bucket against a caller-supplied discriminator (email, user id, or
// "" to key on IP alone). Returns ok:true when allowed, disabled, or on error.
export async function enforceRateLimit(
  bucket: RateLimitBucket,
  discriminator = "",
): Promise<RateLimitResult> {
  const limiter = LIMITERS[bucket];
  if (!limiter) return { ok: true }; // disabled — no Upstash configured

  const ip = await clientIp();
  const key = discriminator ? `${ip}:${discriminator.toLowerCase()}` : ip;

  try {
    const { success, reset } = await limiter.limit(key);
    if (success) return { ok: true };
    const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
    return { ok: false, retryAfter };
  } catch (err) {
    // Fail open — never block auth on a limiter outage.
    console.error(`[rate-limit] ${bucket} check failed, allowing:`, err);
    return { ok: true };
  }
}

// Generic, non-enumerating message for a blocked request.
export function tooManyAttemptsError(retryAfter: number): { error: string } {
  const mins = Math.ceil(retryAfter / 60);
  const when = retryAfter <= 60 ? "a moment" : `${mins} minute${mins > 1 ? "s" : ""}`;
  return { error: `Too many attempts. Please try again in ${when}.` };
}
