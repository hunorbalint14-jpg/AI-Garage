import { describe, expect, it } from "vitest";
import { buildChecklist, tenantBookingUrl, type ChecklistState } from "./setup-checklist";

const EMPTY: ChecklistState = {
  hoursSet: false,
  activeServices: 0,
  bays: 0,
  teamSize: 1,
  stripeChargesEnabled: false,
  logoSet: false,
  xeroConnected: false,
  customers: 0,
};

const DONE: ChecklistState = {
  hoursSet: true,
  activeServices: 3,
  bays: 2,
  teamSize: 4,
  stripeChargesEnabled: true,
  logoSet: true,
  xeroConnected: false, // optional — must not block
  customers: 12,
};

describe("buildChecklist", () => {
  it("fresh org: nothing done, booking page not live", () => {
    const c = buildChecklist(EMPTY, "https://x.ai-garage.co.uk/book");
    expect(c.done).toBe(0);
    expect(c.complete).toBe(false);
    expect(c.bookingLive).toBe(false);
  });

  it("optional steps never block completion", () => {
    const c = buildChecklist(DONE, "https://x.ai-garage.co.uk/book");
    expect(c.done).toBe(c.total);
    expect(c.complete).toBe(true);
    expect(c.steps.find((s) => s.key === "xero")!.done).toBe(false);
  });

  it("booking page goes live from hours + one active service", () => {
    const c = buildChecklist({ ...EMPTY, hoursSet: true, activeServices: 1 }, "u");
    expect(c.bookingLive).toBe(true);
    expect(c.steps.find((s) => s.key === "booking")!.done).toBe(true);
  });

  it("team of one is not a team", () => {
    const c = buildChecklist({ ...EMPTY, teamSize: 1 }, "u");
    expect(c.steps.find((s) => s.key === "team")!.done).toBe(false);
    expect(buildChecklist({ ...EMPTY, teamSize: 2 }, "u").steps.find((s) => s.key === "team")!.done).toBe(true);
  });

  it("every step carries an ask-AI question", () => {
    const c = buildChecklist(EMPTY, "u");
    for (const s of c.steps) expect(s.ask.length).toBeGreaterThan(10);
  });
});

describe("tenantBookingUrl", () => {
  it("https on real domains, http on local", () => {
    const prev = process.env.NEXT_PUBLIC_ROOT_DOMAIN;
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = "ai-garage.co.uk";
    expect(tenantBookingUrl("smith-motors")).toBe("https://smith-motors.ai-garage.co.uk/book");
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = "localtest.me:3000";
    expect(tenantBookingUrl("smith-motors")).toBe("http://smith-motors.localtest.me:3000/book");
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = prev;
  });
});
