import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

const {
  generateBookingConfirmToken,
  hashBookingConfirmToken,
  constantTimeEqualHex,
  tenantBookingConfirmUrl,
} = await import("./booking-confirm");

describe("booking confirm tokens", () => {
  it("generates url-safe tokens of sufficient length", () => {
    const token = generateBookingConfirmToken();
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("hashes deterministically to sha256 hex", () => {
    const h1 = hashBookingConfirmToken("abc");
    const h2 = hashBookingConfirmToken("abc");
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(hashBookingConfirmToken("abd")).not.toBe(h1);
  });

  it("constant-time compare accepts equal and rejects unequal/garbage", () => {
    const h = hashBookingConfirmToken("token");
    expect(constantTimeEqualHex(h, h)).toBe(true);
    expect(constantTimeEqualHex(h, hashBookingConfirmToken("other"))).toBe(false);
    expect(constantTimeEqualHex("", "")).toBe(false);
    expect(constantTimeEqualHex("zz", h)).toBe(false);
  });
});

describe("tenantBookingConfirmUrl", () => {
  it("builds a tenant-scoped url with token", () => {
    vi.stubEnv("NEXT_PUBLIC_ROOT_DOMAIN", "localtest.me:3000");
    const url = tenantBookingConfirmUrl("smith-motors", "b-123", "tok");
    expect(url).toBe("http://smith-motors.localtest.me:3000/confirm/b-123?t=tok");
    vi.unstubAllEnvs();
  });

  it("uses https for production domains", () => {
    vi.stubEnv("NEXT_PUBLIC_ROOT_DOMAIN", "ai-garage.co.uk");
    const url = tenantBookingConfirmUrl("smith-motors", "b-123", "tok");
    expect(url).toBe("https://smith-motors.ai-garage.co.uk/confirm/b-123?t=tok");
    vi.unstubAllEnvs();
  });
});
