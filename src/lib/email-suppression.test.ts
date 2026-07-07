import { describe, it, expect } from "vitest";
import { parseSuppression, isHardBounce, type ResendWebhookEvent } from "./email-suppression";

const ev = (type: string, data: ResendWebhookEvent["data"]): ResendWebhookEvent => ({ type, data });

describe("isHardBounce", () => {
  it("treats permanent/hard as hard, everything else as soft", () => {
    expect(isHardBounce("Permanent")).toBe(true);
    expect(isHardBounce("permanent")).toBe(true);
    expect(isHardBounce("HardBounce")).toBe(true);
    expect(isHardBounce("Transient")).toBe(false);
    expect(isHardBounce("Undetermined")).toBe(false);
    expect(isHardBounce(undefined)).toBe(false);
    expect(isHardBounce("")).toBe(false);
  });
});

describe("parseSuppression", () => {
  it("suppresses a permanent (hard) bounce", () => {
    const out = parseSuppression(ev("email.bounced", { to: ["Dead@Example.com"], bounce: { type: "Permanent", subType: "General" } }));
    expect(out).toEqual([{ email: "dead@example.com", reason: "hard_bounce", detail: "General" }]);
  });

  it("does NOT suppress a transient (soft) bounce", () => {
    expect(parseSuppression(ev("email.bounced", { to: ["a@b.com"], bounce: { type: "Transient" } }))).toEqual([]);
  });

  it("does NOT suppress a bounce with no type (conservative)", () => {
    expect(parseSuppression(ev("email.bounced", { to: ["a@b.com"] }))).toEqual([]);
  });

  it("falls back through subType → message → type for the detail", () => {
    expect(parseSuppression(ev("email.bounced", { to: ["a@b.com"], bounce: { type: "Permanent", message: "550 no such user" } }))[0].detail).toBe("550 no such user");
    expect(parseSuppression(ev("email.bounced", { to: ["a@b.com"], bounce: { type: "Permanent" } }))[0].detail).toBe("Permanent");
  });

  it("suppresses a complaint (no type check needed)", () => {
    expect(parseSuppression(ev("email.complained", { to: ["spam@me.com"] }))).toEqual([
      { email: "spam@me.com", reason: "complaint", detail: null },
    ]);
  });

  it("normalises, dedupes and handles multiple recipients", () => {
    const out = parseSuppression(ev("email.complained", { to: ["  A@X.com ", "a@x.com", "b@x.com"] }));
    expect(out.map((e) => e.email).sort()).toEqual(["a@x.com", "b@x.com"]);
  });

  it("accepts a single string recipient", () => {
    expect(parseSuppression(ev("email.complained", { to: "solo@x.com" }))).toEqual([
      { email: "solo@x.com", reason: "complaint", detail: null },
    ]);
  });

  it("ignores events that don't warrant suppression", () => {
    expect(parseSuppression(ev("email.delivered", { to: ["a@b.com"] }))).toEqual([]);
    expect(parseSuppression(ev("email.opened", { to: ["a@b.com"] }))).toEqual([]);
    expect(parseSuppression(ev("email.bounced", { bounce: { type: "Permanent" } }))).toEqual([]); // no recipient
  });
});
