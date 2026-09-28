import { describe, expect, it } from "vitest";
import { severityTone, summariseStatus, ukDateTime, ukTime, ukTimeWithZone } from "./status-summary";

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
