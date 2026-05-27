import { describe, it, expect } from "vitest";
import { generateToken, shareUrl } from "./doc-shares";

describe("generateToken", () => {
  it("returns a base64url string of decent length", () => {
    const t = generateToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(t.length).toBeGreaterThanOrEqual(40);
  });

  it("returns unique values", () => {
    expect(generateToken()).not.toBe(generateToken());
  });
});

describe("shareUrl", () => {
  it("builds https URL for production root", () => {
    expect(shareUrl("ai-garage.co.uk", "dpa-abc12345", "tok")).toBe(
      "https://ai-garage.co.uk/docs/dpa-abc12345?t=tok",
    );
  });

  it("uses http for localtest.me", () => {
    expect(shareUrl("localtest.me:3000", "dpa-xy", "tok")).toBe(
      "http://localtest.me:3000/docs/dpa-xy?t=tok",
    );
  });

  it("uses http for localhost", () => {
    expect(shareUrl("localhost:3000", "dpa-xy", "tok")).toBe(
      "http://localhost:3000/docs/dpa-xy?t=tok",
    );
  });
});
