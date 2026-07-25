import { describe, it, expect } from "vitest";
import {
  DEFAULT_FIRST_RUN_CAP,
  FIRST_RUN_WINDOW_HOURS,
  firstRunCap,
  inFirstRunWindow,
  mayChaseInvoice,
  type FirstRunPolicy,
} from "./first-run";

const NOW = new Date("2026-07-25T09:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();

const policy = (over: Partial<FirstRunPolicy> = {}): FirstRunPolicy => ({
  live_at: hoursAgo(2),
  first_run_cap: DEFAULT_FIRST_RUN_CAP,
  chase_prelive_debt: false,
  ...over,
});

describe("inFirstRunWindow", () => {
  it("is true inside the window and false after it", () => {
    expect(inFirstRunWindow(hoursAgo(1), NOW)).toBe(true);
    expect(inFirstRunWindow(hoursAgo(FIRST_RUN_WINDOW_HOURS - 0.1), NOW)).toBe(true);
    expect(inFirstRunWindow(hoursAgo(FIRST_RUN_WINDOW_HOURS + 0.1), NOW)).toBe(false);
  });

  it("is false for a branch that never went live", () => {
    expect(inFirstRunWindow(null, NOW)).toBe(false);
    expect(inFirstRunWindow(undefined, NOW)).toBe(false);
  });

  it("treats an unreadable or future timestamp as in-window", () => {
    // Capping too much rolls to the next run; sending too much cannot be undone.
    expect(inFirstRunWindow(hoursAgo(-5), NOW)).toBe(true);
    expect(inFirstRunWindow("not a date", NOW)).toBe(false);
  });
});

describe("firstRunCap", () => {
  it("applies the branch cap during the window", () => {
    expect(firstRunCap(policy({ first_run_cap: 40 }), NOW)).toBe(40);
  });

  it("does not apply once the window has passed", () => {
    expect(firstRunCap(policy({ live_at: hoursAgo(48) }), NOW)).toBeNull();
  });

  it("treats null, zero and negatives as uncapped", () => {
    expect(firstRunCap(policy({ first_run_cap: null }), NOW)).toBeNull();
    expect(firstRunCap(policy({ first_run_cap: 0 }), NOW)).toBeNull();
    expect(firstRunCap(policy({ first_run_cap: -5 }), NOW)).toBeNull();
  });

  it("floors a fractional cap", () => {
    expect(firstRunCap(policy({ first_run_cap: 10.9 }), NOW)).toBe(10);
  });
});

describe("mayChaseInvoice", () => {
  it("never chases debt that was already overdue at go-live", () => {
    const p = policy({ live_at: hoursAgo(2) });
    expect(mayChaseInvoice(p, hoursAgo(200))).toBe(false);
  });

  it("chases invoices that fell due after go-live", () => {
    const p = policy({ live_at: hoursAgo(200) });
    expect(mayChaseInvoice(p, hoursAgo(2))).toBe(true);
  });

  it("stays suppressed beyond the first day — it is not a 24h rule", () => {
    const p = policy({ live_at: hoursAgo(24 * 30) });
    expect(mayChaseInvoice(p, hoursAgo(24 * 40))).toBe(false);
  });

  it("chases everything once the owner opts in", () => {
    const p = policy({ live_at: hoursAgo(2), chase_prelive_debt: true });
    expect(mayChaseInvoice(p, hoursAgo(500))).toBe(true);
  });

  it("does not suppress when it cannot tell", () => {
    // A branch with no live_at is prelive and never dunned anyway; an invoice
    // with no due date isn't overdue. Neither is a reason to block.
    expect(mayChaseInvoice(policy({ live_at: null }), hoursAgo(50))).toBe(true);
    expect(mayChaseInvoice(policy(), null)).toBe(true);
    expect(mayChaseInvoice(policy(), "not a date")).toBe(true);
  });
});
