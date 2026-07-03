import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/sms", () => ({ sendSms: vi.fn() }));
vi.mock("@/lib/whatsapp", () => ({ sendWhatsApp: vi.fn() }));

const { dueReminderDay, normaliseReminderDays } = await import("./quote-reminders");

const DAY_MS = 24 * 60 * 60 * 1000;
const sentAt = new Date("2026-07-01T09:00:00Z");
const iso = (d: Date) => d.toISOString();
const daysAfterSend = (n: number) => new Date(sentAt.getTime() + n * DAY_MS);

const base = {
  sentAt: iso(sentAt),
  lastReminderAt: null as string | null,
  reminderCount: 0,
  reminderDays: [3, 7],
  reminderMax: 2,
  expiresAt: iso(daysAfterSend(30)),
};

describe("dueReminderDay", () => {
  it("nothing due before the first scheduled day", () => {
    expect(dueReminderDay({ ...base, now: daysAfterSend(2.5) })).toBeNull();
  });

  it("day 3 fires on/after day 3", () => {
    expect(dueReminderDay({ ...base, now: daysAfterSend(3) })).toBe(3);
    expect(dueReminderDay({ ...base, now: daysAfterSend(4.5) })).toBe(3);
  });

  it("after the day-3 reminder went out, day 7 is next", () => {
    const args = { ...base, lastReminderAt: iso(daysAfterSend(3)), reminderCount: 1 };
    expect(dueReminderDay({ ...args, now: daysAfterSend(5) })).toBeNull();
    expect(dueReminderDay({ ...args, now: daysAfterSend(7) })).toBe(7);
  });

  it("a missed window catches up with ONE reminder (the latest day), not a burst", () => {
    // Cron was down until day 9 — only day 7 fires, day 3 is absorbed.
    expect(dueReminderDay({ ...base, now: daysAfterSend(9) })).toBe(7);
  });

  it("a manual reminder absorbs auto days it already covers", () => {
    // Staff nudged manually on day 5 → day 3 must not fire late; day 7 still does.
    const args = { ...base, lastReminderAt: iso(daysAfterSend(5)), reminderCount: 1 };
    expect(dueReminderDay({ ...args, now: daysAfterSend(6) })).toBeNull();
    expect(dueReminderDay({ ...args, now: daysAfterSend(7) })).toBe(7);
  });

  it("stops at the max count", () => {
    expect(dueReminderDay({ ...base, reminderCount: 2, now: daysAfterSend(7) })).toBeNull();
  });

  it("never fires on/after expiry", () => {
    expect(dueReminderDay({ ...base, expiresAt: iso(daysAfterSend(6)), now: daysAfterSend(6) })).toBeNull();
    expect(dueReminderDay({ ...base, expiresAt: null, now: daysAfterSend(3) })).toBeNull();
  });

  it("ignores junk day entries", () => {
    expect(dueReminderDay({ ...base, reminderDays: [0, -2, 2.5, 3], now: daysAfterSend(3) })).toBe(3);
    expect(dueReminderDay({ ...base, reminderDays: [], now: daysAfterSend(10) })).toBeNull();
  });
});

describe("normaliseReminderDays", () => {
  it("dedupes, sorts, drops junk, caps at 10", () => {
    expect(normaliseReminderDays([7, 3, 3, 0, -1, 400, 1.5])).toEqual([3, 7]);
    expect(normaliseReminderDays(Array.from({ length: 15 }, (_, i) => i + 1))).toHaveLength(10);
    expect(normaliseReminderDays("junk")).toEqual([]);
  });
});
