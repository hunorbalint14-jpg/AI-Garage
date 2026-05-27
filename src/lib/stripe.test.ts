import { describe, it, expect } from "vitest";
import { platformFeePence, tenantOrigin, tenantPayUrl, publicOrigin } from "./stripe";

describe("platformFeePence", () => {
  it("returns 0 for 0 total", () => {
    expect(platformFeePence(0)).toBe(0);
  });

  it("rounds to nearest pence", () => {
    // 2% of 100p = 2p
    expect(platformFeePence(100)).toBe(2);
    // 2% of 50p = 1p
    expect(platformFeePence(50)).toBe(1);
    // 2% of 51p = 1.02p → rounds to 1
    expect(platformFeePence(51)).toBe(1);
  });

  it("scales with large totals", () => {
    expect(platformFeePence(100_000)).toBe(2000); // £1000 → £20 fee
  });
});

describe("tenantOrigin", () => {
  it("builds {slug}.{root} origin", () => {
    const url = tenantOrigin("acme");
    expect(url).toMatch(/^https:\/\/acme\./);
    expect(url).not.toContain("://localhost");
  });
});

describe("tenantPayUrl", () => {
  it("includes invoice id in path", () => {
    expect(tenantPayUrl("inv_123")).toMatch(/\/pay\/inv_123$/);
  });
});

describe("publicOrigin", () => {
  it("returns an https URL", () => {
    expect(publicOrigin()).toMatch(/^https:\/\//);
  });
});
