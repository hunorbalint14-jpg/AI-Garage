import { describe, it, expect } from "vitest";
import {
  shortReason,
  standardDraft,
  matchTyreService,
  contactCapStatus,
  ANNUAL_TYRE_CARE_CAP,
} from "./tyre-care-messages";
import type { Evidence } from "./tyre-care";

const NOW = new Date("2026-09-27T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

function ev(rule_key: string, inputs: Record<string, unknown> = {}, reason = "Full reason."): Evidence {
  return { rule_key, rule_version: 1, inputs, reason };
}

describe("shortReason", () => {
  it("states the mileage and what it's measured from", () => {
    expect(shortReason(ev("rotation.interval", { miles_since_baseline: 8365, baseline_kind: "rotation" }))).toBe(
      "it's about 8,365 miles since they were last rotated",
    );
    expect(shortReason(ev("rotation.interval", { miles_since_baseline: 7000, baseline_kind: "fitment" }))).toBe(
      "it's about 7,000 miles since your new tyres went on",
    );
  });

  it("names the worn axle for a tread-gap rotation", () => {
    expect(shortReason(ev("rotation.tread_differential", { front_worn_more: false }))).toMatch(/rear tyres/);
    expect(shortReason(ev("rotation.tread_differential", { front_worn_more: true }))).toMatch(/front tyres/);
  });

  it("covers every alignment rule", () => {
    for (const key of [
      "alignment.axle_differential",
      "alignment.mot_advisory",
      "alignment.after_steering_work",
      "alignment.new_tyres_unaligned",
    ]) {
      expect(shortReason(ev(key))).not.toBe("Full reason.");
    }
  });

  it("falls back to the full reason for an unknown rule", () => {
    expect(shortReason(ev("something.new"))).toBe("Full reason.");
  });
});

describe("standardDraft", () => {
  const draft = standardDraft({
    firstName: "Charlie",
    registration: "AB19 CDE",
    vehicleName: "Volkswagen Golf",
    serviceType: "rotation",
    evidence: ev("rotation.interval", { miles_since_baseline: 8365 }, "About 8,365 miles since your tyres were rotated."),
    garageLabel: "Smith Motors",
  });

  it("always states the evidence — the trust guardrail", () => {
    expect(draft.email).toContain("About 8,365 miles since your tyres were rotated.");
    expect(draft.sms).toContain("8,365 miles");
  });

  it("names the car, the service and the benefit", () => {
    expect(draft.subject).toBe("Tyre rotation recommended for AB19 CDE — Smith Motors");
    expect(draft.email).toContain("Volkswagen Golf (AB19 CDE)");
    expect(draft.email).toMatch(/lasts longer/);
  });

  it("keeps the text message short enough to read at a glance", () => {
    expect(draft.sms.length).toBeLessThan(160);
  });
});

describe("matchTyreService", () => {
  const services = [
    { id: "s1", name: "Full service" },
    { id: "s2", name: "4-Wheel Tracking" },
    { id: "s3", name: "Tyre rotation" },
  ];

  it("matches the ways UK garages name these", () => {
    expect(matchTyreService(services, "alignment")).toBe("s2");
    expect(matchTyreService(services, "rotation")).toBe("s3");
    expect(matchTyreService([{ id: "x", name: "Wheel alignment" }], "alignment")).toBe("x");
  });

  it("returns null rather than guessing", () => {
    expect(matchTyreService(services, "balance")).toBeNull();
  });
});

describe("contactCapStatus", () => {
  it("allows a customer nobody has contacted recently", () => {
    expect(contactCapStatus({ lastContactedAt: daysAgo(45), lastContactKind: "MOT reminder", tyreCareSendsLastYear: 1, now: NOW })).toEqual({ allowed: true });
    expect(contactCapStatus({ lastContactedAt: null, lastContactKind: null, tyreCareSendsLastYear: 0, now: NOW })).toEqual({ allowed: true });
  });

  it("blocks inside 30 days and says when it opens up", () => {
    const cap = contactCapStatus({ lastContactedAt: daysAgo(10), lastContactKind: "MOT reminder", tyreCareSendsLastYear: 0, now: NOW });
    expect(cap.allowed).toBe(false);
    if (!cap.allowed) {
      expect(cap.reason).toContain("10 days ago (MOT reminder)");
      expect(cap.availableFrom).toBe("2026-10-17");
    }
  });

  it("enforces the yearly ceiling", () => {
    const cap = contactCapStatus({ lastContactedAt: null, lastContactKind: null, tyreCareSendsLastYear: ANNUAL_TYRE_CARE_CAP, now: NOW });
    expect(cap.allowed).toBe(false);
  });
});
