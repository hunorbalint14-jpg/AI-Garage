import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock next/headers so clientIp() can be exercised outside a request scope.
const headerStore = new Map<string, string>();
vi.mock("next/headers", () => ({
  headers: async () => ({ get: (k: string) => headerStore.get(k.toLowerCase()) ?? null }),
}));

const { enforceRateLimit, tooManyAttemptsError, clientIp } = await import("./rate-limit");

beforeEach(() => headerStore.clear());

describe("enforceRateLimit (Upstash unconfigured)", () => {
  // CI has no UPSTASH_* env, so every bucket limiter is null → fail-open allow.
  it("allows when the limiter is disabled", async () => {
    expect(await enforceRateLimit("login", "a@b.test")).toEqual({ ok: true });
    expect(await enforceRateLimit("email", "a@b.test")).toEqual({ ok: true });
    expect(await enforceRateLimit("token")).toEqual({ ok: true });
  });
});

describe("clientIp", () => {
  it("takes the first hop of x-forwarded-for", async () => {
    headerStore.set("x-forwarded-for", "203.0.113.7, 70.41.3.18, 150.172.238.178");
    expect(await clientIp()).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip then 'unknown'", async () => {
    headerStore.set("x-real-ip", "198.51.100.5");
    expect(await clientIp()).toBe("198.51.100.5");
    headerStore.clear();
    expect(await clientIp()).toBe("unknown");
  });
});

describe("tooManyAttemptsError", () => {
  it("says 'a moment' for short waits", () => {
    expect(tooManyAttemptsError(30)).toEqual({
      error: "Too many attempts. Please try again in a moment.",
    });
    expect(tooManyAttemptsError(60).error).toContain("a moment");
  });

  it("rounds up to minutes for longer waits", () => {
    expect(tooManyAttemptsError(61).error).toContain("2 minutes");
    expect(tooManyAttemptsError(120).error).toContain("2 minutes");
    expect(tooManyAttemptsError(90).error).toContain("2 minutes");
  });
});
