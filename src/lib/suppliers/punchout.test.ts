import { describe, it, expect } from "vitest";
import { buildPunchoutUrl, isValidPunchoutTemplate } from "./punchout";

describe("buildPunchoutUrl", () => {
  it("substitutes and url-encodes the placeholders", () => {
    const url = buildPunchoutUrl("https://factor.example/search?vrm={reg}&q={query}", {
      reg: "AB12 CDE",
      query: "front brake discs",
    });
    expect(url).toBe("https://factor.example/search?vrm=AB12%20CDE&q=front%20brake%20discs");
  });

  it("substitutes empty strings for missing vars rather than leaving placeholders", () => {
    const url = buildPunchoutUrl("https://factor.example/search?q={query}", {});
    expect(url).toBe("https://factor.example/search?q=");
  });

  it("accepts a template with no placeholders", () => {
    expect(buildPunchoutUrl("https://factor.example/catalogue")).toBe("https://factor.example/catalogue");
  });

  it("rejects blank templates", () => {
    expect(buildPunchoutUrl(null)).toBeNull();
    expect(buildPunchoutUrl("   ")).toBeNull();
  });

  it("rejects non-http schemes — the result lands in an href", () => {
    expect(buildPunchoutUrl("javascript:alert(1)")).toBeNull();
    expect(buildPunchoutUrl("data:text/html,<script>")).toBeNull();
    expect(buildPunchoutUrl("factor.example/search")).toBeNull();
  });

  it("isValidPunchoutTemplate mirrors the builder", () => {
    expect(isValidPunchoutTemplate("https://factor.example/s?q={query}")).toBe(true);
    expect(isValidPunchoutTemplate("javascript:alert(1)")).toBe(false);
  });
});
