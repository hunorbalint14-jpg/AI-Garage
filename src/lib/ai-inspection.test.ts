import { describe, expect, it } from "vitest";
import { parseRewriteResponse } from "./ai-inspection";

const IDS = ["a", "b", "c"];

describe("parseRewriteResponse", () => {
  it("parses a plain JSON response", () => {
    const raw = JSON.stringify({
      findings: [
        { id: "a", summary: "Front brake pads are worn.", repair: "Replace front pads", catalogue: 2 },
        { id: "b", summary: "Tyre is below the legal limit.", repair: null, catalogue: null },
      ],
    });
    const out = parseRewriteResponse(raw, IDS, 3);
    expect(out).toEqual([
      { id: "a", summary: "Front brake pads are worn.", repair: "Replace front pads", catalogueIndex: 2 },
      { id: "b", summary: "Tyre is below the legal limit.", repair: null, catalogueIndex: null },
    ]);
  });

  it("strips markdown code fences", () => {
    const raw = '```json\n{"findings":[{"id":"a","summary":"Worn."}]}\n```';
    const out = parseRewriteResponse(raw, IDS, 0);
    expect(out).toHaveLength(1);
    expect(out[0].catalogueIndex).toBeNull();
  });

  it("drops unknown ids and keeps the first occurrence of duplicates", () => {
    const raw = JSON.stringify({
      findings: [
        { id: "zzz", summary: "Not one of ours." },
        { id: "a", summary: "First." },
        { id: "a", summary: "Second — ignored." },
      ],
    });
    const out = parseRewriteResponse(raw, IDS, 0);
    expect(out).toEqual([{ id: "a", summary: "First.", repair: null, catalogueIndex: null }]);
  });

  it("nulls out-of-range catalogue picks instead of failing", () => {
    const raw = JSON.stringify({
      findings: [
        { id: "a", summary: "Ok.", catalogue: 4 },
        { id: "b", summary: "Ok.", catalogue: 0 },
        { id: "c", summary: "Ok.", catalogue: 3 },
      ],
    });
    const out = parseRewriteResponse(raw, IDS, 3);
    expect(out.map((f) => f.catalogueIndex)).toEqual([null, null, 3]);
  });

  it("skips findings with an empty summary", () => {
    const raw = JSON.stringify({ findings: [{ id: "a", summary: "  " }, { id: "b", summary: "Fine." }] });
    const out = parseRewriteResponse(raw, IDS, 0);
    expect(out.map((f) => f.id)).toEqual(["b"]);
  });

  it("throws on malformed JSON", () => {
    expect(() => parseRewriteResponse("not json at all", IDS, 0)).toThrow();
  });

  it("caps summary and repair length", () => {
    const raw = JSON.stringify({
      findings: [{ id: "a", summary: "x".repeat(1500), repair: "y".repeat(500), catalogue: null }],
    });
    const out = parseRewriteResponse(raw, IDS, 0);
    expect(out[0].summary).toHaveLength(1000);
    expect(out[0].repair).toHaveLength(200);
  });
});
