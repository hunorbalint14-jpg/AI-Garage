import { describe, expect, it } from "vitest";
import { parseSuggestion } from "./ai-import-mapping";

const HEADERS = ["col_a", "col_b", "col_c", "col_d"];

describe("parseSuggestion", () => {
  it("applies high/medium, keeps low as hint only", () => {
    const raw = JSON.stringify({
      mappings: [
        { target: "registration", source: "col_a", confidence: "high" },
        { target: "happened_on", source: "col_b", confidence: "medium" },
        { target: "total", source: "col_c", confidence: "low" },
      ],
    });
    const s = parseSuggestion(raw, "history", HEADERS)!;
    expect(s.mapping.registration).toBe("col_a");
    expect(s.mapping.happened_on).toBe("col_b");
    expect(s.mapping.total).toBeNull(); // low never auto-applies
    expect(s.suggestions.total).toEqual({ source: "col_c", confidence: "low" });
  });

  it("drops unknown targets, unknown headers and duplicate sources", () => {
    const raw = JSON.stringify({
      mappings: [
        { target: "not_a_field", source: "col_a", confidence: "high" },
        { target: "registration", source: "not_a_header", confidence: "high" },
        { target: "happened_on", source: "col_a", confidence: "high" },
        { target: "description", source: "col_a", confidence: "high" }, // dup source
      ],
    });
    const s = parseSuggestion(raw, "history", HEADERS)!;
    expect(s.suggestions).toEqual({ happened_on: { source: "col_a", confidence: "high" } });
  });

  it("survives prose-wrapped JSON; garbage returns null", () => {
    const wrapped = `Here you go:\n{"mappings":[{"target":"registration","source":"col_a","confidence":"high"}]}\nDone.`;
    expect(parseSuggestion(wrapped, "history", HEADERS)!.mapping.registration).toBe("col_a");
    expect(parseSuggestion("no json here", "history", HEADERS)).toBeNull();
    expect(parseSuggestion('{"mappings": "nope"}', "history", HEADERS)).toBeNull();
  });
});
