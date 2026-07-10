import { describe, expect, it } from "vitest";
import { authorisedTotal, decodeSignatureDataUrl, variationState, SIGNATURE_MAX_BYTES } from "./work-auth";

describe("variationState", () => {
  it("no artefact → none", () => {
    expect(variationState(500, null, 10)).toEqual({ state: "none" });
  });

  it("within tolerance → ok", () => {
    expect(variationState(440, 412, 10)).toEqual({ state: "ok", authorised: 412, live: 440 });
    // Exactly at the limit is still ok.
    expect(variationState(453.2, 412, 10)).toEqual({ state: "ok", authorised: 412, live: 453.2 });
  });

  it("beyond tolerance → exceeds with delta + percentage", () => {
    expect(variationState(512, 412, 10)).toEqual({
      state: "exceeds",
      authorised: 412,
      live: 512,
      overBy: 100,
      overPct: 24,
    });
  });

  it("zero threshold flags any increase", () => {
    expect(variationState(412.5, 412, 0).state).toBe("exceeds");
    expect(variationState(412, 412, 0).state).toBe("ok");
  });

  it("zero authorised total never divides by zero", () => {
    expect(variationState(100, 0, 10).state).toBe("ok");
  });
});

describe("authorisedTotal", () => {
  it("sums line totals with per-line VAT", () => {
    expect(
      authorisedTotal([
        { quantity: 2, unit_price: 100, vat_rate: 20 }, // 240
        { quantity: 1, unit_price: 54.85, vat_rate: 0 }, // MOT: outside scope
      ]),
    ).toBe(294.85);
  });

  it("empty items → 0", () => {
    expect(authorisedTotal([])).toBe(0);
  });

  it("rounds to pennies", () => {
    expect(authorisedTotal([{ quantity: 3, unit_price: 33.333, vat_rate: 20 }])).toBe(120);
  });
});

describe("decodeSignatureDataUrl", () => {
  // Minimal valid PNG header (magic + truncated body) base64'd.
  const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const good = `data:image/png;base64,${pngMagic.toString("base64")}`;

  it("decodes a PNG data URL", () => {
    const buf = decodeSignatureDataUrl(good);
    expect(buf).not.toBeNull();
    expect(buf!.readUInt32BE(0)).toBe(0x89504e47);
  });

  it("rejects non-PNG mime, junk, and oversized payloads", () => {
    expect(decodeSignatureDataUrl("data:image/jpeg;base64,AAAA")).toBeNull();
    expect(decodeSignatureDataUrl("not a data url")).toBeNull();
    const big = `data:image/png;base64,${Buffer.concat([pngMagic, Buffer.alloc(SIGNATURE_MAX_BYTES)]).toString("base64")}`;
    expect(decodeSignatureDataUrl(big)).toBeNull();
  });

  it("rejects a fake PNG without magic bytes", () => {
    const fake = `data:image/png;base64,${Buffer.from("definitely not png").toString("base64")}`;
    expect(decodeSignatureDataUrl(fake)).toBeNull();
  });
});
