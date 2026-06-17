import { describe, it, expect } from "vitest";
import { aiBriefSystemBlock, emptyAnswers } from "./ai-profile";

describe("aiBriefSystemBlock", () => {
  it("returns empty string for no brief", () => {
    expect(aiBriefSystemBlock(null)).toBe("");
    expect(aiBriefSystemBlock(undefined)).toBe("");
    expect(aiBriefSystemBlock("   ")).toBe("");
  });

  it("wraps a brief in a delimited block", () => {
    const out = aiBriefSystemBlock("This garage specialises in EVs.");
    expect(out).toContain("ABOUT THIS GARAGE");
    expect(out).toContain("This garage specialises in EVs.");
    expect(out.startsWith("\n\n")).toBe(true);
  });
});

describe("emptyAnswers", () => {
  it("provides arrays for multi-selects and string defaults", () => {
    const a = emptyAnswers();
    expect(Array.isArray(a.specialisms)).toBe(true);
    expect(Array.isArray(a.services)).toBe(true);
    expect(a.tone.length).toBeGreaterThan(0);
    expect(a.bookingPreference.length).toBeGreaterThan(0);
  });
});
