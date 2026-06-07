import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isPlatformAdmin, platformAdminEmails } from "./platform-admin";

const ORIGINAL = process.env.PLATFORM_ADMIN_EMAILS;

afterEach(() => {
  process.env.PLATFORM_ADMIN_EMAILS = ORIGINAL;
});

describe("isPlatformAdmin", () => {
  beforeEach(() => {
    process.env.PLATFORM_ADMIN_EMAILS = "owner@aigarage.io, Ops@AIGarage.io ";
  });

  it("matches an allowlisted email case-insensitively, ignoring whitespace", () => {
    expect(isPlatformAdmin("owner@aigarage.io")).toBe(true);
    expect(isPlatformAdmin("OWNER@AIGARAGE.IO")).toBe(true);
    expect(isPlatformAdmin("  ops@aigarage.io ")).toBe(true);
  });

  it("rejects non-listed, null, undefined, and empty", () => {
    expect(isPlatformAdmin("random@example.com")).toBe(false);
    expect(isPlatformAdmin(null)).toBe(false);
    expect(isPlatformAdmin(undefined)).toBe(false);
    expect(isPlatformAdmin("")).toBe(false);
  });

  it("denies everyone when the allowlist is unset/empty", () => {
    process.env.PLATFORM_ADMIN_EMAILS = "";
    expect(platformAdminEmails().size).toBe(0);
    expect(isPlatformAdmin("owner@aigarage.io")).toBe(false);
    delete process.env.PLATFORM_ADMIN_EMAILS;
    expect(isPlatformAdmin("owner@aigarage.io")).toBe(false);
  });
});
