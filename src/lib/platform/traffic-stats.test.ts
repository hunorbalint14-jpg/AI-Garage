import { describe, it, expect } from "vitest";
import { addCounts, topEntries, pctDelta, utcDayKeys, foldRawRows, sumSeries } from "./traffic-stats";

describe("addCounts / topEntries", () => {
  it("merges and ranks", () => {
    const t = addCounts({ a: 1 }, { a: 2, b: 5 });
    addCounts(t, null);
    expect(t).toEqual({ a: 3, b: 5 });
    expect(topEntries(t, 1)).toEqual([["b", 5]]);
  });
});

describe("pctDelta", () => {
  it("rounds and nulls on empty previous", () => {
    expect(pctDelta(120, 100)).toBe(20);
    expect(pctDelta(80, 100)).toBe(-20);
    expect(pctDelta(5, 0)).toBeNull();
  });
});

describe("utcDayKeys", () => {
  it("builds consecutive UTC days", () => {
    expect(utcDayKeys(new Date("2026-07-09T00:00:00Z"), 3)).toEqual(["2026-07-09", "2026-07-10", "2026-07-11"]);
  });
});

const raw = (over: Partial<Parameters<typeof foldRawRows>[0][number]>) => ({
  occurred_at: "2026-07-11T10:00:00Z",
  organization_id: "org1",
  surface: "booking",
  visitor_hash: "h1",
  device: "mobile",
  browser: "Chrome Mobile",
  os: "Android",
  country: "GB",
  city: "Leeds",
  referrer_host: null,
  path: "/book",
  ...over,
});

describe("foldRawRows", () => {
  it("groups by bucket+org+surface and dedupes visitors by hash", () => {
    const slices = foldRawRows(
      [raw({}), raw({ visitor_hash: "h1", path: "/" }), raw({ visitor_hash: "h2" }), raw({ organization_id: null, surface: "marketing" })],
      (iso) => iso.slice(0, 10),
    );
    const booking = slices.find((s) => s.surface === "booking")!;
    expect(booking.pageviews).toBe(3);
    expect(booking.visitors).toBe(2);
    expect(booking.devices).toEqual({ mobile: 3 });
    expect(booking.cities).toEqual({ Leeds: 3 });
    expect(slices.find((s) => s.surface === "marketing")!.organizationId).toBeNull();
  });

  it("buckets by hour when asked", () => {
    const slices = foldRawRows(
      [raw({ occurred_at: "2026-07-11T09:10:00Z" }), raw({ occurred_at: "2026-07-11T10:50:00Z" })],
      (iso) => `${String(new Date(iso).getUTCHours()).padStart(2, "0")}:00`,
    );
    expect(slices.map((s) => s.bucket).sort()).toEqual(["09:00", "10:00"]);
  });
});

describe("sumSeries", () => {
  it("positions slice totals on the bucket axis", () => {
    const slices = foldRawRows(
      [raw({ occurred_at: "2026-07-10T10:00:00Z" }), raw({ occurred_at: "2026-07-11T10:00:00Z", visitor_hash: "h9" })],
      (iso) => iso.slice(0, 10),
    );
    const { visitors, pageviews } = sumSeries(slices, ["2026-07-10", "2026-07-11"]);
    expect(visitors).toEqual([1, 1]);
    expect(pageviews).toEqual([1, 1]);
  });
});

