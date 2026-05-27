import { describe, it, expect } from "vitest";
import { normalizeRegistration, validateRegistration } from "./registration";

describe("normalizeRegistration", () => {
  it("uppercases", () => {
    expect(normalizeRegistration("ab12cde")).toBe("AB12CDE");
  });

  it("strips spaces", () => {
    expect(normalizeRegistration("AB12 CDE")).toBe("AB12CDE");
    expect(normalizeRegistration("  A B  ")).toBe("AB");
  });

  it("trims outer whitespace", () => {
    expect(normalizeRegistration("  AB12CDE  ")).toBe("AB12CDE");
  });
});

describe("validateRegistration", () => {
  it.each([
    ["AB12CDE", null],
    ["ab12 cde", null], // normalised before validate
    ["A1", null],
    ["ABC123", null],
    ["12345678", null], // 8 chars max
  ])("accepts %s", (input, expected) => {
    expect(validateRegistration(input)).toBe(expected);
  });

  it("rejects empty", () => {
    expect(validateRegistration("")).toMatch(/required/i);
    expect(validateRegistration("   ")).toMatch(/required/i);
  });

  it("rejects symbols", () => {
    expect(validateRegistration("AB-12")).toMatch(/letters and numbers/i);
    expect(validateRegistration("AB.12")).toMatch(/letters and numbers/i);
  });

  it("rejects > 8 chars", () => {
    expect(validateRegistration("ABCDEFGHI")).toMatch(/letters and numbers/i);
  });
});
