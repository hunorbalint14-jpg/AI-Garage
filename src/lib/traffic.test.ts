import { describe, it, expect } from "vitest";
import {
  visitorHash,
  utcDayString,
  normalizePath,
  classifySurface,
  referrerHost,
  parseUserAgent,
  geoFromHeaders,
} from "./traffic";

describe("visitorHash", () => {
  it("is deterministic for the same day + identity", () => {
    const a = visitorHash("secret", "2026-07-11", "1.2.3.4", "UA", "smith.example.com");
    const b = visitorHash("secret", "2026-07-11", "1.2.3.4", "UA", "smith.example.com");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });

  it("rotates across days and differs across hosts", () => {
    const day1 = visitorHash("secret", "2026-07-11", "1.2.3.4", "UA", "a.example.com");
    const day2 = visitorHash("secret", "2026-07-12", "1.2.3.4", "UA", "a.example.com");
    const other = visitorHash("secret", "2026-07-11", "1.2.3.4", "UA", "b.example.com");
    expect(day1).not.toBe(day2);
    expect(day1).not.toBe(other);
  });

  it("utcDayString gives yyyy-mm-dd", () => {
    expect(utcDayString(new Date("2026-07-11T23:59:59Z"))).toBe("2026-07-11");
  });
});

describe("normalizePath", () => {
  it("masks token-gated route segments even when they look readable", () => {
    expect(normalizePath("/quote/summer-service-a8f3")).toBe("/quote/:slug");
    expect(normalizePath("/review/abc123")).toBe("/review/:slug");
    expect(normalizePath("/pay/9f8e7d6c-1a2b-4c3d-9e8f-7a6b5c4d3e2f")).toBe("/pay/:id");
    expect(normalizePath("/invoice/INV-2041")).toBe("/invoice/:id");
  });

  it("masks uuids, long tokens and numbers generically", () => {
    expect(normalizePath("/staff/jobs/9f8e7d6c-1a2b-4c3d-9e8f-7a6b5c4d3e2f")).toBe("/staff/jobs/:id");
    expect(normalizePath("/dashboard/history/AbCdEf1234567890xyz")).toBe("/dashboard/history/:id");
    expect(normalizePath("/staff/bookings/42")).toBe("/staff/bookings/:n");
  });

  it("keeps static paths, strips query/hash, lowercases", () => {
    expect(normalizePath("/book?service=mot#step-2")).toBe("/book");
    expect(normalizePath("/Pricing")).toBe("/pricing");
    expect(normalizePath("/")).toBe("/");
  });

  it("caps depth and segment length", () => {
    const deep = "/a/b/c/d/e/f/g/h/i";
    expect(normalizePath(deep).split("/").length - 1).toBeLessThanOrEqual(6);
    const long = `/${"x".repeat(500)}`;
    expect(normalizePath(long).length).toBeLessThanOrEqual(200);
  });
});

describe("classifySurface", () => {
  it("maps the portals", () => {
    expect(classifySurface("/staff/jobs")).toBe("staff");
    expect(classifySurface("/book")).toBe("booking");
    expect(classifySurface("/confirm/:id")).toBe("booking");
    expect(classifySurface("/dashboard")).toBe("portal");
    expect(classifySurface("/quote/:slug")).toBe("docs");
    expect(classifySurface("/pay/:id")).toBe("docs");
    expect(classifySurface("/")).toBe("marketing");
    expect(classifySurface("/b/:slug")).toBe("marketing");
    expect(classifySurface("/api/whatever")).toBe("other");
  });
});

describe("referrerHost", () => {
  it("keeps external hosts, drops anything under the platform root", () => {
    expect(referrerHost("https://www.google.co.uk/search?q=mot", "ai-garage.co.uk")).toBe("www.google.co.uk");
    expect(referrerHost("https://smith.ai-garage.co.uk/book", "ai-garage.co.uk")).toBeNull();
    expect(referrerHost("https://ai-garage.co.uk/", "ai-garage.co.uk")).toBeNull();
  });

  it("does not label-count eTLDs — co.uk sites are external", () => {
    expect(referrerHost("https://checkmot.service.gov.uk/x", "ai-garage.co.uk")).toBe("checkmot.service.gov.uk");
  });

  it("handles junk", () => {
    expect(referrerHost("", "example.com")).toBeNull();
    expect(referrerHost(null, "example.com")).toBeNull();
    expect(referrerHost("not a url", "example.com")).toBeNull();
  });
});

describe("parseUserAgent", () => {
  it("classifies an iPhone", () => {
    const r = parseUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    );
    expect(r).toMatchObject({ device: "mobile", os: "iOS", isBot: false });
    expect(r.browser).toBe("Safari Mobile");
  });

  it("classifies desktop Chrome on Windows", () => {
    const r = parseUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    );
    expect(r).toMatchObject({ device: "desktop", browser: "Chrome", os: "Windows", isBot: false });
  });

  it("classifies Android tablet vs phone", () => {
    const phone = parseUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36");
    const tablet = parseUserAgent("Mozilla/5.0 (Linux; Android 14; SM-X910) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36");
    expect(phone.device).toBe("mobile");
    expect(tablet.device).toBe("tablet");
  });

  it("flags bots and empty UA", () => {
    expect(parseUserAgent("Mozilla/5.0 (compatible; Googlebot/2.1)").isBot).toBe(true);
    expect(parseUserAgent("WhatsApp/2.23.20 A").isBot).toBe(true);
    expect(parseUserAgent("curl/8.4.0").isBot).toBe(true);
    expect(parseUserAgent(null).isBot).toBe(true);
  });
});

describe("geoFromHeaders", () => {
  it("decodes the encoded city and passes country/region", () => {
    const h = new Map([
      ["x-vercel-ip-country", "GB"],
      ["x-vercel-ip-country-region", "ENG"],
      ["x-vercel-ip-city", "St%20Albans"],
    ]);
    expect(geoFromHeaders((n) => h.get(n) ?? null)).toEqual({ country: "GB", region: "ENG", city: "St Albans" });
  });

  it("nulls when headers absent", () => {
    expect(geoFromHeaders(() => null)).toEqual({ country: null, region: null, city: null });
  });
});
