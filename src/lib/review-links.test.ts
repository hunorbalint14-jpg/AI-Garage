import { describe, it, expect } from "vitest";
import { generateReviewToken, hashReviewToken, tenantReviewUrl } from "./review-links";

describe("review tokens", () => {
  it("generates a URL-safe ~43-char token", () => {
    const t = generateReviewToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(t.length).toBeGreaterThanOrEqual(43);
    expect(generateReviewToken()).not.toBe(t);
  });

  it("hashes deterministically as 64-hex, differing per input", () => {
    const h = hashReviewToken("token-abc");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashReviewToken("token-abc")).toBe(h);
    expect(hashReviewToken("token-abd")).not.toBe(h);
  });
});

describe("tenantReviewUrl", () => {
  it("builds an https tenant URL for a production root domain", () => {
    const prev = process.env.NEXT_PUBLIC_ROOT_DOMAIN;
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = "ai-garage.co.uk";
    expect(tenantReviewUrl("smith-motors", "tok123")).toBe(
      "https://smith-motors.ai-garage.co.uk/review/tok123",
    );
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = prev;
  });

  it("uses http for localtest dev domains", () => {
    const prev = process.env.NEXT_PUBLIC_ROOT_DOMAIN;
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = "localtest.me:3000";
    expect(tenantReviewUrl("smith-motors", "tok123")).toBe(
      "http://smith-motors.localtest.me:3000/review/tok123",
    );
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = prev;
  });
});
