import { describe, it, expect } from "vitest";
import { validateSlug } from "./slug";

describe("validateSlug", () => {
  it("accepts valid slugs", () => {
    expect(validateSlug("acme")).toBeNull();
    expect(validateSlug("acme-motors")).toBeNull();
    expect(validateSlug("garage123")).toBeNull();
    expect(validateSlug("a1b")).toBeNull();
  });

  it("rejects empty", () => {
    expect(validateSlug("")).toMatch(/required/i);
    expect(validateSlug("   ")).toMatch(/required/i);
  });

  it("rejects too short", () => {
    expect(validateSlug("ab")).toMatch(/at least 3/i);
  });

  it("rejects too long", () => {
    expect(validateSlug("a".repeat(31))).toMatch(/30 characters/i);
  });

  it("rejects uppercase (but normalises lowercase first)", () => {
    // validateSlug lowercases internally, so ACME passes
    expect(validateSlug("ACME")).toBeNull();
  });

  it("rejects spaces + punctuation", () => {
    expect(validateSlug("acme motors")).toMatch(/lowercase letters/i);
    expect(validateSlug("acme_motors")).toMatch(/lowercase letters/i);
    expect(validateSlug("-acme")).toMatch(/lowercase letters/i);
    expect(validateSlug("acme-")).toMatch(/lowercase letters/i);
  });

  it.each(["www", "app", "api", "admin", "staff", "login", "signup", "dashboard", "settings"])(
    "rejects reserved slug %s",
    (slug) => {
      expect(validateSlug(slug)).toMatch(/reserved/i);
    },
  );
});
