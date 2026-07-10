import { describe, expect, it } from "vitest";
import { dueTouch, TOUCH_DAYS } from "./activation-emails";

const NOW = new Date("2026-07-12T09:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

describe("dueTouch", () => {
  it("day 1/3/7 schedule", () => {
    expect(TOUCH_DAYS).toEqual([1, 3, 7]);
    // Brand new org: nothing due yet.
    expect(dueTouch(0, daysAgo(0), NOW)).toBeNull();
    // Day 1 touch fires from 24h.
    expect(dueTouch(0, daysAgo(1), NOW)).toBe(0);
    // Stage 1 waits for day 3…
    expect(dueTouch(1, daysAgo(2), NOW)).toBeNull();
    expect(dueTouch(1, daysAgo(3), NOW)).toBe(1);
    // …stage 2 for day 7.
    expect(dueTouch(2, daysAgo(6), NOW)).toBeNull();
    expect(dueTouch(2, daysAgo(7), NOW)).toBe(2);
  });

  it("a missed day sends late, never twice", () => {
    // Cron down for a week: org is 9 days old at stage 0 → day-1 touch only.
    expect(dueTouch(0, daysAgo(9), NOW)).toBe(0);
    // After it sends (stage 1), the day-3 touch is immediately due — one per
    // sweep, so the sequence catches up a day at a time, in order.
    expect(dueTouch(1, daysAgo(9), NOW)).toBe(1);
  });

  it("finished or out-of-range stages never fire", () => {
    expect(dueTouch(3, daysAgo(30), NOW)).toBeNull();
    expect(dueTouch(-1, daysAgo(30), NOW)).toBeNull();
  });
});
