import { describe, it, expect, afterEach } from "vitest";
import {
  generateQuoteToken,
  generateQuoteSlug,
  generateStandaloneQuoteSlug,
  hashQuoteToken,
  tenantQuoteUrl,
} from "./quote-links";

describe("generateQuoteToken", () => {
  it("returns a base64url string with no padding", () => {
    const t = generateQuoteToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(t).not.toContain("=");
    expect(t.length).toBeGreaterThanOrEqual(40);
  });

  it("returns a unique value each call", () => {
    const a = generateQuoteToken();
    const b = generateQuoteToken();
    expect(a).not.toBe(b);
  });
});

describe("generateQuoteSlug", () => {
  it("matches q-<10 hex chars> format", () => {
    expect(generateQuoteSlug()).toMatch(/^q-[0-9a-f]{10}$/);
  });
});

describe("generateStandaloneQuoteSlug", () => {
  it("matches sq-<10 hex chars> format", () => {
    expect(generateStandaloneQuoteSlug()).toMatch(/^sq-[0-9a-f]{10}$/);
  });

  it("differs from DVI slug prefix so verifyQuoteAccess can route", () => {
    expect(generateStandaloneQuoteSlug().startsWith("sq-")).toBe(true);
    expect(generateQuoteSlug().startsWith("q-")).toBe(true);
    expect(generateQuoteSlug().startsWith("sq-")).toBe(false);
  });
});

describe("hashQuoteToken", () => {
  it("is deterministic", () => {
    expect(hashQuoteToken("abc")).toBe(hashQuoteToken("abc"));
  });

  it("returns 64 hex chars (sha256)", () => {
    expect(hashQuoteToken("anything")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs for different inputs", () => {
    expect(hashQuoteToken("a")).not.toBe(hashQuoteToken("b"));
  });
});

describe("tenantQuoteUrl", () => {
  const origRoot = process.env.NEXT_PUBLIC_ROOT_DOMAIN;

  afterEach(() => {
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = origRoot;
  });

  it("builds https URL for production root", () => {
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = "ai-garage.co.uk";
    const url = tenantQuoteUrl("acme", "q-abc123", "tok");
    expect(url).toBe("https://acme.ai-garage.co.uk/quote/q-abc123?t=tok");
  });

  it("uses http for localtest.me", () => {
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = "localtest.me:3000";
    const url = tenantQuoteUrl("acme", "q-abc", "tok");
    expect(url).toBe("http://acme.localtest.me:3000/quote/q-abc?t=tok");
  });
});

