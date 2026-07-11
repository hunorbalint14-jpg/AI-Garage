import { describe, expect, it } from "vitest";
import { parseSiteCopy } from "./ai-minisite-copy";

describe("parseSiteCopy", () => {
  it("parses clean and prose-wrapped JSON, caps lengths", () => {
    expect(parseSiteCopy('{"strapline":"Family-run MOT centre.","about":"We fix cars."}')).toEqual({
      strapline: "Family-run MOT centre.",
      about: "We fix cars.",
    });
    const wrapped = 'Sure:\n{"strapline":"x","about":"y"}\nHope that helps!';
    expect(parseSiteCopy(wrapped)).toEqual({ strapline: "x", about: "y" });
    const long = parseSiteCopy(`{"strapline":"${"a".repeat(500)}","about":"b"}`)!;
    expect(long.strapline.length).toBe(160);
  });

  it("garbage or empty → null", () => {
    expect(parseSiteCopy("no json")).toBeNull();
    expect(parseSiteCopy('{"strapline":7}')).toBeNull();
  });
});
