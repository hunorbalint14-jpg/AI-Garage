import { describe, it, expect } from "vitest";
import { isLocationLive, isPrelive } from "./prelive";

describe("prelive gate", () => {
  it("treats a stamped live_at as live", () => {
    expect(isLocationLive({ live_at: "2026-07-25T09:00:00Z" })).toBe(true);
    expect(isPrelive({ live_at: "2026-07-25T09:00:00Z" })).toBe(false);
  });

  it("treats null as prelive — new branches start silenced", () => {
    expect(isLocationLive({ live_at: null })).toBe(false);
    expect(isPrelive({ live_at: null })).toBe(true);
  });

  it("fails closed on a missing or malformed row", () => {
    // A location we couldn't load must never be treated as live: the cost of a
    // wrong "live" is messaging a real customer.
    expect(isLocationLive(null)).toBe(false);
    expect(isLocationLive(undefined)).toBe(false);
    expect(isLocationLive({} as { live_at: string | null })).toBe(false);
  });

  it("treats an empty string as prelive, not live", () => {
    expect(isLocationLive({ live_at: "" })).toBe(false);
  });
});
