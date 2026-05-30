import { describe, it, expect } from "vitest";
import { safeInternalPath } from "./safe-redirect";

describe("safeInternalPath", () => {
  it("accepts ordinary internal paths", () => {
    expect(safeInternalPath("/staff")).toBe("/staff");
    expect(safeInternalPath("/dashboard?x=1")).toBe("/dashboard?x=1");
    expect(safeInternalPath("/reset-password")).toBe("/reset-password");
  });

  it("rejects protocol-relative and backslash bypasses", () => {
    expect(safeInternalPath("//evil.com")).toBe("/staff");
    expect(safeInternalPath("/\\evil.com")).toBe("/staff");
  });

  it("rejects absolute URLs", () => {
    expect(safeInternalPath("https://evil.com")).toBe("/staff");
    expect(safeInternalPath("http://evil.com/path")).toBe("/staff");
    expect(safeInternalPath("evil.com")).toBe("/staff");
  });

  it("falls back on empty/missing input", () => {
    expect(safeInternalPath(null)).toBe("/staff");
    expect(safeInternalPath(undefined)).toBe("/staff");
    expect(safeInternalPath("")).toBe("/staff");
  });

  it("honours a custom fallback", () => {
    expect(safeInternalPath("//evil.com", "/dashboard")).toBe("/dashboard");
    expect(safeInternalPath(null, "/dashboard")).toBe("/dashboard");
  });
});
