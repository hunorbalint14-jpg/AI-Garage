import { describe, expect, it } from "vitest";
import { parsePartsSuggestions, matchProduct } from "./ai-parts";

describe("parsePartsSuggestions", () => {
  it("parses a clean array, normalises category, caps quantity shaping", () => {
    const raw = JSON.stringify([
      { name: "Front brake discs (pair)", category: "brakes", quantity: 1, caveat: "confirm 288mm" },
      { name: "5W-30 oil", category: "CONSUMABLES", quantity: 4.5, caveat: "" },
    ]);
    const out = parsePartsSuggestions(raw);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ name: "Front brake discs (pair)", category: "brakes", quantity: 1 });
    expect(out[1].category).toBe("consumables"); // lowercased
    expect(out[1].quantity).toBe(4.5);
  });

  it("unknown category → other; prose-wrapped JSON tolerated; garbage → []", () => {
    expect(parsePartsSuggestions('Here:\n[{"name":"X","category":"wheels","quantity":2,"caveat":""}]\ndone')[0].category).toBe("other");
    expect(parsePartsSuggestions("no json")).toEqual([]);
    expect(parsePartsSuggestions('[{"name":"","category":"brakes","quantity":1,"caveat":""}]')).toEqual([]);
  });

  it("caps at 8", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ name: `Part ${i}`, category: "other", quantity: 1, caveat: "" }));
    expect(parsePartsSuggestions(JSON.stringify(many))).toHaveLength(8);
  });
});

describe("matchProduct", () => {
  const products = [
    { id: "p1", name: "Front Brake Pads", category: "brakes" },
    { id: "p2", name: "Oil Filter", category: "filters" },
    { id: "p3", name: "Brake Disc Front (each)", category: "brakes" },
  ];
  it("matches on majority-word overlap", () => {
    expect(matchProduct({ name: "Front brake pads", category: "brakes" }, products)?.id).toBe("p1");
    expect(matchProduct({ name: "Oil filter", category: "filters" }, products)?.id).toBe("p2");
  });
  it("no confident match → null (a stray shared word doesn't mis-map)", () => {
    expect(matchProduct({ name: "Cabin pollen filter", category: "filters" }, products)).toBeNull();
    expect(matchProduct({ name: "Wiper blades", category: "other" }, products)).toBeNull();
    // The real bug this guards: brake DISCS must not grab the brake PADS product
    // on the shared word "brake" + same category.
    expect(matchProduct({ name: "Front brake discs (pair)", category: "brakes" }, products)?.id).not.toBe("p1");
  });
});
