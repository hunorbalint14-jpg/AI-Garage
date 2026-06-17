import { describe, it, expect } from "vitest";
import {
  garageLabel,
  addressOneLine,
  garageLocationBlock,
  garageLocationInline,
} from "./garage-identity";

describe("garageLabel", () => {
  it("appends the branch when it differs from the org", () => {
    expect(garageLabel({ orgName: "Smith Motors", locationName: "Camden" })).toBe(
      "Smith Motors — Camden",
    );
  });

  it("omits the branch for single-location orgs (name matches the org)", () => {
    expect(garageLabel({ orgName: "Smith Motors", locationName: "Smith Motors" })).toBe(
      "Smith Motors",
    );
  });

  it("treats the branch name case-insensitively when de-duping", () => {
    expect(garageLabel({ orgName: "Smith Motors", locationName: "smith motors" })).toBe(
      "Smith Motors",
    );
  });

  it("falls back to the org name when the branch is missing", () => {
    expect(garageLabel({ orgName: "Smith Motors", locationName: null })).toBe("Smith Motors");
    expect(garageLabel({ orgName: "Smith Motors" })).toBe("Smith Motors");
  });
});

describe("addressOneLine", () => {
  it("collapses a multi-line address to a comma-joined line", () => {
    expect(addressOneLine("12 High St\nCamden\nNW1 0AB")).toBe("12 High St, Camden, NW1 0AB");
  });

  it("trims stray whitespace around the separators", () => {
    expect(addressOneLine("  12 High St \n  Camden  \n NW1 0AB ")).toBe(
      "12 High St, Camden, NW1 0AB",
    );
  });

  it("returns null for empty / whitespace-only input", () => {
    expect(addressOneLine(null)).toBeNull();
    expect(addressOneLine("")).toBeNull();
    expect(addressOneLine("   \n  ")).toBeNull();
  });
});

describe("garageLocationBlock", () => {
  it("puts the address under the branch label", () => {
    expect(
      garageLocationBlock({
        orgName: "Smith Motors",
        locationName: "Camden",
        address: "12 High St\nCamden, NW1 0AB",
      }),
    ).toBe("Smith Motors — Camden\n12 High St\nCamden, NW1 0AB");
  });

  it("is just the label when no address is set", () => {
    expect(garageLocationBlock({ orgName: "Smith Motors", locationName: "Camden" })).toBe(
      "Smith Motors — Camden",
    );
  });
});

describe("garageLocationInline", () => {
  it("joins label and one-line address with a comma", () => {
    expect(
      garageLocationInline({
        orgName: "Smith Motors",
        locationName: "Camden",
        address: "12 High St\nNW1 0AB",
      }),
    ).toBe("Smith Motors — Camden, 12 High St, NW1 0AB");
  });

  it("is just the label when no address is set", () => {
    expect(garageLocationInline({ orgName: "Smith Motors", locationName: "Camden" })).toBe(
      "Smith Motors — Camden",
    );
  });
});
