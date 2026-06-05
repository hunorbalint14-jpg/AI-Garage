import { describe, it, expect } from "vitest";
import {
  generatePlanInviteToken,
  generatePlanInviteSlug,
  hashPlanInviteToken,
  tenantPlanInviteUrl,
} from "./plan-invites";

describe("generatePlanInviteSlug", () => {
  it("is prefixed pi- and unique-ish", () => {
    const a = generatePlanInviteSlug();
    const b = generatePlanInviteSlug();
    expect(a.startsWith("pi-")).toBe(true);
    expect(a).not.toBe(b);
  });
});

describe("generatePlanInviteToken", () => {
  it("returns a long url-safe token", () => {
    const t = generatePlanInviteToken();
    expect(t.length).toBeGreaterThanOrEqual(40);
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/); // base64url
  });
});

describe("hashPlanInviteToken", () => {
  it("is deterministic and not the raw token", () => {
    const t = "some-token";
    expect(hashPlanInviteToken(t)).toBe(hashPlanInviteToken(t));
    expect(hashPlanInviteToken(t)).not.toBe(t);
    expect(hashPlanInviteToken(t)).toHaveLength(64); // sha256 hex
  });
});

describe("tenantPlanInviteUrl", () => {
  it("builds a tenant-scoped /plan/{slug}?t= URL", () => {
    const url = tenantPlanInviteUrl("smith-motors", "pi-abc123", "tok");
    expect(url).toContain("smith-motors.");
    expect(url).toContain("/plan/pi-abc123?t=tok");
  });
});
