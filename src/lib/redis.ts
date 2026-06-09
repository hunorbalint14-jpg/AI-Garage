import { Redis } from "@upstash/redis";

// Shared Upstash Redis client (REST/fetch-based, so it works on the Edge
// middleware runtime too). Null when unconfigured — local dev and any
// environment not yet provisioned. Every caller must treat a cache miss as the
// normal path and fail OPEN: caching must never block or break a request.
//
// Accepts both our own env names and the ones Vercel's Upstash Marketplace
// integration injects (`UPSTASH_KV_REST_API_*`). Mirrors rate-limit.ts, which
// now imports this client.
const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.UPSTASH_KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.UPSTASH_KV_REST_API_TOKEN;

export const redis = url && token ? new Redis({ url, token }) : null;

// Read a JSON value. Returns null on: Redis unset, missing key, or any error
// (fail-open). Note: a stored empty string "" reads back as "" (not null), so
// callers can use "" as an explicit negative-cache marker distinct from a miss.
export async function cacheGet<T>(key: string): Promise<T | null> {
  if (!redis) return null;
  try {
    return (await redis.get<T>(key)) ?? null;
  } catch (err) {
    console.error("[cache] get failed", key, err);
    return null;
  }
}

// Write a JSON value with a TTL in seconds. No-op when Redis is unset; never throws.
export async function cacheSet<T>(key: string, value: T, ttlSec: number): Promise<void> {
  if (!redis) return;
  try {
    await redis.set(key, value, { ex: ttlSec });
  } catch (err) {
    console.error("[cache] set failed", key, err);
  }
}

// Best-effort invalidation. No-op when Redis is unset; never throws.
export async function cacheDel(key: string): Promise<void> {
  if (!redis) return;
  try {
    await redis.del(key);
  } catch (err) {
    console.error("[cache] del failed", key, err);
  }
}
