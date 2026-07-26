import { describe, it, expect } from "vitest";
import {
  parseDamageMarkers,
  summariseDamage,
  newDamage,
  nextMarkerId,
  DAMAGE_MAX_MARKERS,
  type DamageMarker,
} from "./courtesy-damage";

const marker = (over: Partial<DamageMarker> = {}): DamageMarker => ({
  id: "m1",
  view: "front",
  x: 10,
  y: 20,
  code: "S",
  size: "S",
  note: null,
  ...over,
});

describe("parseDamageMarkers", () => {
  it("returns [] for anything that is not an array", () => {
    expect(parseDamageMarkers(null)).toEqual([]);
    expect(parseDamageMarkers({})).toEqual([]);
    expect(parseDamageMarkers("[]")).toEqual([]);
  });

  it("keeps valid markers and drops unrecognised ones", () => {
    const parsed = parseDamageMarkers([
      marker(),
      { ...marker(), view: "roof" },
      { ...marker(), code: "ZZ" },
      null,
      "nope",
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].view).toBe("front");
  });

  it("clamps coordinates into the view box", () => {
    const [a, b] = parseDamageMarkers([
      { ...marker(), id: "a", x: -20, y: 250 },
      { ...marker(), id: "b", x: "33.333", y: Number.NaN },
    ]);
    expect(a.x).toBe(0);
    expect(a.y).toBe(100);
    expect(b.x).toBe(33.3);
    expect(b.y).toBe(0);
  });

  it("falls back to a small size when the band is unknown", () => {
    expect(parseDamageMarkers([{ ...marker(), size: "XL" }])[0].size).toBe("S");
  });

  it("trims notes to null when blank", () => {
    expect(parseDamageMarkers([{ ...marker(), note: "   " }])[0].note).toBeNull();
    expect(parseDamageMarkers([{ ...marker(), note: " kerbed " }])[0].note).toBe("kerbed");
  });

  it("caps the marker count", () => {
    const many = Array.from({ length: DAMAGE_MAX_MARKERS + 10 }, (_, i) =>
      marker({ id: `m${i}` }),
    );
    expect(parseDamageMarkers(many)).toHaveLength(DAMAGE_MAX_MARKERS);
  });
});

describe("summariseDamage", () => {
  it("is empty with no markers", () => {
    expect(summariseDamage([])).toBe("");
  });

  it("counts and pluralises by code", () => {
    const summary = summariseDamage([
      marker({ id: "a", code: "S" }),
      marker({ id: "b", code: "S" }),
      marker({ id: "c", code: "D" }),
    ]);
    expect(summary).toBe("2 scratches, 1 dent");
  });

  it("uses the singular label for a lone marker", () => {
    expect(summariseDamage([marker({ code: "M" })])).toBe("1 missing");
    expect(summariseDamage([marker({ code: "M" }), marker({ id: "b", code: "M" })])).toBe(
      "2 missing items",
    );
  });
});

describe("nextMarkerId", () => {
  it("never repeats across many mints", () => {
    const ids = new Set(Array.from({ length: 500 }, () => nextMarkerId()));
    expect(ids.size).toBe(500);
  });

  it("avoids ids already taken", () => {
    // Mint one, then claim it — the next mint must not hand it back.
    const claimed = nextMarkerId();
    for (let i = 0; i < 50; i++) {
      expect(nextMarkerId([claimed])).not.toBe(claimed);
    }
  });

  it("does not depend on crypto.randomUUID (not available on plain http)", () => {
    const original = globalThis.crypto;
    // @ts-expect-error — deliberately removing the global for this assertion.
    delete globalThis.crypto;
    try {
      expect(() => nextMarkerId()).not.toThrow();
    } finally {
      globalThis.crypto = original;
    }
  });
});

describe("newDamage", () => {
  it("returns only markers added since check-out", () => {
    const out = [marker({ id: "a" })];
    const back = [marker({ id: "a" }), marker({ id: "b", code: "D" })];
    const added = newDamage(out, back);
    expect(added.map((m) => m.id)).toEqual(["b"]);
  });

  it("is empty when the car comes back as it left", () => {
    const out = [marker({ id: "a" }), marker({ id: "b" })];
    expect(newDamage(out, out)).toEqual([]);
  });
});
