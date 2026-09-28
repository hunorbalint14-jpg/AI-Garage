import { describe, expect, it } from "vitest";
import { groupByUkDay, incidentDuration, incidentWindow, severityTone, summariseStatus, ukDateTime, ukTime, ukTimeWithZone } from "./status-summary";

describe("summariseStatus", () => {
  it("is all clear with no incidents", () => {
    const s = summariseStatus([]);
    expect(s.overall).toBe("ok");
    expect(s.unmapped).toBe(false);
    expect([...s.components.values()].every((t) => t === "ok")).toBe(true);
  });

  it("moves the headline for an incident that names no components", () => {
    // Auto-declared incidents always have components: [] — this is the case
    // that used to leave "All systems operational" above a SEV-1.
    const s = summariseStatus([{ severity: "SEV-1", components: [] }]);
    expect(s.overall).toBe("bad");
    expect(s.unmapped).toBe(true);
    expect([...s.components.values()].every((t) => t === "ok")).toBe(true);
  });

  it("marks the named components and takes the worst severity", () => {
    const s = summariseStatus([
      { severity: "SEV-3", components: ["Payments", "Email"] },
      { severity: "SEV-2", components: ["Payments"] },
    ]);
    expect(s.overall).toBe("bad");
    expect(s.components.get("Payments")).toBe("bad");
    expect(s.components.get("Email")).toBe("warn");
    expect(s.components.get("Staff dashboard")).toBe("ok");
    expect(s.unmapped).toBe(false);
  });

  it("treats components it doesn't know as unmapped rather than dropping the incident", () => {
    const s = summariseStatus([{ severity: "SEV-4", components: ["Retired service"] }]);
    expect(s.overall).toBe("warn");
    expect(s.unmapped).toBe(true);
  });

  it("maps severities to tones", () => {
    expect(severityTone("SEV-1")).toBe("bad");
    expect(severityTone("SEV-2")).toBe("bad");
    expect(severityTone("SEV-3")).toBe("warn");
    expect(severityTone("SEV-4")).toBe("warn");
  });
});

describe("UK time formatting", () => {
  it("shows BST in summer", () => {
    expect(ukTime("2026-09-28T11:10:00Z")).toBe("12:10");
    expect(ukTimeWithZone("2026-09-28T11:10:00Z")).toBe("12:10 BST");
    expect(ukDateTime("2026-09-28T11:10:00Z")).toMatch(/^28 Sept?, 12:10 BST$/);
  });

  it("shows GMT in winter", () => {
    expect(ukTimeWithZone("2026-12-01T09:05:00Z")).toBe("09:05 GMT");
  });
});

describe("incidentDuration", () => {
  const at = (m: number) => new Date(Date.parse("2026-09-28T10:00:00Z") + m * 60_000).toISOString();
  it.each([
    [0, "under a minute"],
    [42, "42 min"],
    [60, "1 h"],
    [185, "3 h 5 min"],
    [24 * 60, "1 day"],
    [52 * 60 + 10, "2 days 4 h"],
  ])("%i minutes → %s", (m, expected) => {
    expect(incidentDuration(at(0), at(m))).toBe(expected);
  });

  it("never goes negative on a bad clock", () => {
    expect(incidentDuration(at(10), at(0))).toBe("under a minute");
  });
});

describe("groupByUkDay", () => {
  it("groups by the London calendar day, newest first", () => {
    const groups = groupByUkDay([
      { id: "a", started_at: "2026-09-28T09:00:00Z" },
      { id: "b", started_at: "2026-09-26T12:00:00Z" },
      { id: "c", started_at: "2026-09-28T07:00:00Z" },
    ]);
    expect(groups.map((g) => g.items.map((i) => i.id))).toEqual([["a", "c"], ["b"]]);
    expect(groups[0].label).toBe("Monday 28 September");
  });

  it("puts a just-after-midnight BST incident on the UK day, not the UTC one", () => {
    // 23:30 UTC on the 27th is 00:30 BST on the 28th.
    const [g] = groupByUkDay([{ id: "x", started_at: "2026-09-27T23:30:00Z" }]);
    expect(g.label).toBe("Monday 28 September");
  });
});

describe("incidentWindow", () => {
  it("drops the date when the incident started and ended on the same UK day", () => {
    expect(incidentWindow("2026-09-28T10:06:00Z", "2026-09-28T10:48:00Z")).toBe("11:06 – 11:48 BST");
  });

  it("dates both ends when it ran past midnight", () => {
    expect(incidentWindow("2026-09-27T21:00:00Z", "2026-09-28T01:30:00Z")).toMatch(/^27 Sept?, 22:00 – 28 Sept?, 02:30$/);
  });
});
