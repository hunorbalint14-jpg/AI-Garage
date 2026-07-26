import { describe, expect, it } from "vitest";
import {
  actionsFor,
  briefFor,
  computeInsight,
  daysUntil,
  dueUrgency,
  formatAgo,
  formatNextDue,
  healthScore,
  nextDueFor,
  segmentsFor,
  signalFor,
  type InsightInput,
  type InsightVehicle,
} from "./customer-insights";

// Fixed clock so every expectation is a plain arithmetic statement.
const NOW = Date.UTC(2026, 6, 26, 9, 0, 0); // 26 Jul 2026
const DAY = 86_400_000;
const inDays = (n: number) => new Date(NOW + n * DAY).toISOString();
const agoDays = (n: number) => new Date(NOW - n * DAY).toISOString();

function vehicle(overrides: Partial<InsightVehicle> = {}): InsightVehicle {
  return {
    id: "veh-1",
    registration: "AB19 CDE",
    motExpiry: null,
    serviceDue: null,
    taxDue: null,
    ...overrides,
  };
}

function input(overrides: Partial<InsightInput> = {}): InsightInput {
  return {
    fullName: "Charlie Customer",
    vehicles: [vehicle()],
    balance: 0,
    lifetimeValue: 0,
    visitCount: 0,
    lastVisitAt: null,
    createdAt: agoDays(30),
    hasPlan: false,
    openQuote: null,
    remindersSent: 0,
    remindersOpened: 0,
    lastReminderAt: null,
    now: NOW,
    ...overrides,
  };
}

describe("daysUntil", () => {
  it("is null for a missing or unparseable date", () => {
    expect(daysUntil(null, NOW)).toBeNull();
    expect(daysUntil("not-a-date", NOW)).toBeNull();
  });

  it("counts forward and backward from now", () => {
    expect(daysUntil(inDays(17), NOW)).toBe(17);
    expect(daysUntil(agoDays(6), NOW)).toBe(-6);
  });
});

describe("nextDueFor", () => {
  it("returns null when nothing has a date", () => {
    expect(nextDueFor([vehicle()], NOW)).toBeNull();
  });

  it("picks the soonest date across every vehicle and every kind", () => {
    const due = nextDueFor(
      [
        vehicle({ id: "a", registration: "AAA", motExpiry: inDays(90), serviceDue: inDays(54) }),
        vehicle({ id: "b", registration: "BBB", taxDue: inDays(21) }),
      ],
      NOW,
    );
    expect(due).toEqual({ kind: "tax", days: 21, vehicleId: "b", registration: "BBB" });
  });

  it("prefers an overdue date over an upcoming one", () => {
    const due = nextDueFor([vehicle({ motExpiry: agoDays(6), serviceDue: inDays(3) })], NOW);
    expect(due?.kind).toBe("mot");
    expect(due?.days).toBe(-6);
  });
});

describe("dueUrgency", () => {
  it("bands at 30 and 60 days, overdue included in red", () => {
    expect(dueUrgency(null)).toBe("none");
    expect(dueUrgency(-1)).toBe("red");
    expect(dueUrgency(30)).toBe("red");
    expect(dueUrgency(31)).toBe("amber");
    expect(dueUrgency(60)).toBe("amber");
    expect(dueUrgency(61)).toBe("green");
  });
});

describe("formatNextDue / formatAgo", () => {
  it("formats the next-due cell", () => {
    expect(formatNextDue(null)).toBe("—");
    expect(formatNextDue({ kind: "mot", days: 17, vehicleId: "v", registration: "R" })).toBe("MOT · 17d");
    expect(formatNextDue({ kind: "service", days: -12, vehicleId: "v", registration: "R" })).toBe(
      "Service · overdue 12d",
    );
  });

  it("formats the last-in cell across the scale", () => {
    expect(formatAgo(null, NOW)).toBe("never");
    expect(formatAgo(agoDays(0), NOW)).toBe("today");
    expect(formatAgo(agoDays(1), NOW)).toBe("yesterday");
    expect(formatAgo(agoDays(5), NOW)).toBe("5 days ago");
    expect(formatAgo(agoDays(35), NOW)).toBe("5 wks ago");
    expect(formatAgo(agoDays(330), NOW)).toBe("11 mos ago");
    expect(formatAgo(agoDays(420), NOW)).toBe("1 yr ago");
  });
});

describe("healthScore", () => {
  it("stays inside 0–100 for the worst case", () => {
    const score = healthScore(
      input({
        vehicles: [vehicle({ motExpiry: agoDays(400) })],
        lastVisitAt: agoDays(900),
        balance: 1200,
        remindersSent: 6,
        remindersOpened: 0,
        openQuote: { id: "q", total: 200, sentAt: agoDays(40) },
        createdAt: agoDays(1200),
      }),
    );
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThan(40);
  });

  it("rewards a loyal, recent, plan-holding customer", () => {
    const score = healthScore(
      input({
        vehicles: [vehicle({ motExpiry: inDays(200), serviceDue: inDays(150) })],
        lastVisitAt: agoDays(20),
        visitCount: 12,
        hasPlan: true,
        createdAt: agoDays(900),
      }),
    );
    expect(score).toBeGreaterThanOrEqual(70);
  });

  it("drops when work is overdue", () => {
    const base = input({ vehicles: [vehicle({ motExpiry: inDays(200) })], lastVisitAt: agoDays(30) });
    const overdue = { ...base, vehicles: [vehicle({ motExpiry: agoDays(20) })] };
    expect(healthScore(overdue)).toBeLessThan(healthScore(base));
  });

  it("drops when money is owed", () => {
    const base = input({ lastVisitAt: agoDays(30), visitCount: 3 });
    expect(healthScore({ ...base, balance: 600 })).toBeLessThan(healthScore(base));
  });

  it("does not punish a brand-new record that has never visited", () => {
    const fresh = healthScore(input({ createdAt: agoDays(3) }));
    const dormant = healthScore(input({ createdAt: agoDays(400) }));
    expect(fresh).toBeGreaterThan(dormant);
  });
});

describe("segmentsFor", () => {
  it("flags an imminent MOT only from an MOT date", () => {
    const withMot = input({ vehicles: [vehicle({ motExpiry: inDays(9) })] });
    expect(segmentsFor(withMot, healthScore(withMot))).toContain("mot30");

    const taxOnly = input({ vehicles: [vehicle({ taxDue: inDays(9) })] });
    expect(segmentsFor(taxOnly, healthScore(taxOnly))).not.toContain("mot30");
  });

  it("flags a balance and a plan", () => {
    const i = input({ balance: 342.5, hasPlan: true });
    const segments = segmentsFor(i, healthScore(i));
    expect(segments).toContain("owes");
    expect(segments).toContain("plan");
  });

  it("flags 'quiet' on a long absence", () => {
    const i = input({ lastVisitAt: agoDays(330), visitCount: 4, createdAt: agoDays(900) });
    expect(segmentsFor(i, healthScore(i))).toContain("quiet");
  });

  it("flags 'quiet' when the gap outruns the customer's own cadence", () => {
    // 6 visits over 3 years = ~2/yr, so ~180 days is the normal gap. 200 days
    // is short in absolute terms but 1.6x their pattern.
    const i = input({ createdAt: agoDays(1095), visitCount: 6, lastVisitAt: agoDays(320) });
    expect(segmentsFor(i, healthScore(i))).toContain("quiet");
  });

  it("flags 'needs attention' only below 50 health", () => {
    const healthy = input({ lastVisitAt: agoDays(20), visitCount: 10, hasPlan: true });
    expect(segmentsFor(healthy, healthScore(healthy))).not.toContain("attention");
  });
});

describe("signalFor", () => {
  it("churn beats everything for a long-lapsed repeat customer", () => {
    const i = input({ lastVisitAt: agoDays(430), visitCount: 8, vehicles: [vehicle({ motExpiry: inDays(9) })] });
    expect(signalFor(i, segmentsFor(i, healthScore(i)))).toBe("churn");
  });

  it("an open quote outranks an upcoming due date", () => {
    const i = input({
      lastVisitAt: agoDays(40),
      openQuote: { id: "q1", total: 248, sentAt: agoDays(12) },
      vehicles: [vehicle({ motExpiry: inDays(17) })],
    });
    expect(signalFor(i, segmentsFor(i, healthScore(i)))).toBe("quote");
  });

  it("'book' for imminent work on an active customer", () => {
    const i = input({ lastVisitAt: agoDays(35), visitCount: 4, vehicles: [vehicle({ motExpiry: inDays(17) })] });
    expect(signalFor(i, segmentsFor(i, healthScore(i)))).toBe("book");
  });

  it("no signal when nothing is due and the customer is active", () => {
    const i = input({ lastVisitAt: agoDays(30), visitCount: 5, vehicles: [vehicle({ motExpiry: inDays(200) })] });
    expect(signalFor(i, segmentsFor(i, healthScore(i)))).toBeNull();
  });
});

describe("briefFor", () => {
  it("names the vehicle and the gap for a booking nudge", () => {
    const i = input({ lastVisitAt: agoDays(35), vehicles: [vehicle({ motExpiry: inDays(17), registration: "AB19 CDE" })] });
    const brief = briefFor(i, "book");
    expect(brief).toContain("MOT due in 17 days on AB19 CDE");
    expect(brief).toContain("Charlie");
  });

  it("quotes the real amount outstanding rather than a generic nudge", () => {
    const brief = briefFor(input({ balance: 342.5 }), null);
    expect(brief).toContain("£342.50");
  });

  it("only claims the customer opens reminders when the data says so", () => {
    const engaged = briefFor(
      input({ remindersSent: 4, remindersOpened: 3, lastVisitAt: agoDays(20), vehicles: [vehicle({ motExpiry: inDays(10) })] }),
      "book",
    );
    const silent = briefFor(
      input({ remindersSent: 4, remindersOpened: 0, lastVisitAt: agoDays(20), vehicles: [vehicle({ motExpiry: inDays(10) })] }),
      "book",
    );
    expect(engaged).toContain("opens the reminders");
    expect(silent).not.toContain("opens the reminders");
  });

  it("falls back gracefully with no name on file", () => {
    expect(briefFor(input({ fullName: null }), null)).toContain("This customer");
  });
});

describe("actionsFor", () => {
  it("never offers a reminder for a date the vehicle doesn't carry", () => {
    const taxOnly = input({ vehicles: [vehicle({ taxDue: inDays(8) })] });
    expect(actionsFor(taxOnly, "book").some((a) => a.kind === "reminder")).toBe(false);
  });

  it("targets the reminder at the vehicle that is actually due", () => {
    const i = input({
      lastVisitAt: agoDays(20),
      vehicles: [
        vehicle({ id: "a", registration: "AAA", motExpiry: inDays(120) }),
        vehicle({ id: "b", registration: "BBB", serviceDue: inDays(4) }),
      ],
    });
    const action = actionsFor(i, "book").find((a) => a.kind === "reminder");
    expect(action).toMatchObject({ kind: "reminder", vehicleId: "b", reminderType: "service" });
  });

  it("links to the open quote it is talking about", () => {
    const i = input({ openQuote: { id: "q-9", total: 248, sentAt: agoDays(12) } });
    expect(actionsFor(i, "quote")).toContainEqual(
      expect.objectContaining({ kind: "link", href: "/staff/quotes/q-9" }),
    );
  });

  it("does not offer a plan invite to an existing member", () => {
    const i = input({ hasPlan: true, lastVisitAt: agoDays(400), visitCount: 5 });
    expect(actionsFor(i, "churn").some((a) => a.kind === "plan")).toBe(false);
  });

  it("caps at three so the panel never scrolls", () => {
    const i = input({ balance: 200, vehicles: [vehicle({ motExpiry: inDays(5) })] });
    expect(actionsFor(i, null).length).toBeLessThanOrEqual(3);
  });

  it("always offers at least one thing to do", () => {
    expect(actionsFor(input({ hasPlan: true }), null).length).toBeGreaterThan(0);
  });
});

describe("computeInsight", () => {
  it("returns a consistent bundle for the flagship case", () => {
    const result = computeInsight(
      input({
        fullName: "Charlie Customer",
        vehicles: [vehicle({ motExpiry: inDays(17), serviceDue: inDays(54), taxDue: inDays(218) })],
        balance: 342.5,
        lifetimeValue: 2340,
        visitCount: 9,
        lastVisitAt: agoDays(35),
        hasPlan: true,
        createdAt: agoDays(900),
      }),
    );
    expect(result.nextDue).toMatchObject({ kind: "mot", days: 17 });
    expect(result.aiSignal).toBe("book");
    expect(result.segments).toEqual(expect.arrayContaining(["mot30", "owes", "plan"]));
    expect(result.actions.length).toBeGreaterThan(0);
    expect(result.brief.length).toBeGreaterThan(20);
  });
});
