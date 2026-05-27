import { describe, it, expect } from "vitest";
import { tenantBookingUrl } from "./email";

describe("tenantBookingUrl", () => {
  it("builds tenant subdomain URL", () => {
    // PUBLIC_ORIGIN is set at module load. With test env NEXT_PUBLIC_ROOT_DOMAIN=ai-garage.test
    // the helper falls back to ai-garage.co.uk because the test env doesn't include localtest.
    const url = tenantBookingUrl("acme");
    expect(url).toMatch(/^https:\/\/acme\./);
    expect(url).toMatch(/\/book$/);
  });

  it("supports custom path", () => {
    const url = tenantBookingUrl("acme", "/dashboard");
    expect(url).toMatch(/\/dashboard$/);
  });
});
