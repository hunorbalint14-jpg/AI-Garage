import { describe, expect, it } from "vitest";
import { openingHoursSpecification, autoRepairJsonLd, siteTitle, siteDescription } from "./minisite-seo";
import type { MiniSite } from "./minisite-data";

const WEEKLY = {
  1: { open: 480, close: 1080 },
  2: { open: 480, close: 1080 },
  3: { open: 480, close: 1080 },
  4: { open: 480, close: 1080 },
  5: { open: 480, close: 1080 },
  6: { open: 540, close: 780 },
};

const SITE: MiniSite = {
  org: {
    name: "Smith Motors",
    slug: "smith-motors",
    primaryColor: "#e11",
    logoUrl: null,
    phone: "020 7946 0000",
    googleReviewUrl: "https://g.page/r/abc/review",
  },
  strapline: null,
  about: null,
  sections: { services: true, hours: true, branches: true, reviews: true, about: true },
  branches: [
    {
      id: "b1",
      slug: "smith-motors",
      name: "Smith Motors",
      address: "12 Colindale Avenue, London NW9 5HR",
      weekly: WEEKLY,
      special: [],
      services: [{ name: "MOT Test", price: 54.85, category: null, durationMinutes: 60 }],
    },
  ],
};

describe("openingHoursSpecification", () => {
  it("groups identical days; closed days absent", () => {
    const spec = openingHoursSpecification(WEEKLY);
    expect(spec).toHaveLength(2);
    const weekdays = spec.find((s) => s.dayOfWeek.includes("Monday"))!;
    expect(weekdays.dayOfWeek).toEqual(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]);
    expect(weekdays.opens).toBe("08:00");
    expect(weekdays.closes).toBe("18:00");
    expect(spec.flatMap((s) => s.dayOfWeek)).not.toContain("Sunday");
  });
});

describe("autoRepairJsonLd", () => {
  it("emits required AutoRepair fields, no undefined keys", () => {
    const ld = autoRepairJsonLd(SITE, SITE.branches[0], "https://smith-motors.ai-garage.co.uk/");
    expect(ld["@type"]).toBe("AutoRepair");
    expect(ld.name).toBe("Smith Motors");
    expect(ld.telephone).toBe("020 7946 0000");
    expect((ld.address as { streetAddress: string }).streetAddress).toMatch(/Colindale/);
    expect(Array.isArray(ld.openingHoursSpecification)).toBe(true);
    expect(JSON.stringify(ld)).not.toContain("undefined");
    expect(ld.image).toBeUndefined(); // logo null → key dropped
  });
});

describe("title + description", () => {
  it("title picks the town from the address; description falls back to services", () => {
    expect(siteTitle(SITE)).toContain("Smith Motors — MOT, Servicing & Repairs in London");
    expect(siteDescription(SITE)).toContain("MOT Test");
    expect(siteDescription({ ...SITE, strapline: "Honest garage." })).toBe("Honest garage.");
  });
});
