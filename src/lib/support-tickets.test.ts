import { describe, it, expect } from "vitest";
import {
  statusesForType,
  isValidStatusChange,
  isTerminalForStaff,
  nextStatusOnStaffReply,
  statusPatch,
  shortTicketRef,
  buildTicketContext,
} from "./support-tickets";

const NOW = "2026-07-05T12:00:00.000Z";

describe("statusesForType", () => {
  it("offers planned/declined only to feature requests", () => {
    expect(statusesForType("feature_request")).toContain("planned");
    expect(statusesForType("feature_request")).toContain("declined");
    expect(statusesForType("bug")).not.toContain("planned");
    expect(statusesForType("bug")).not.toContain("declined");
    expect(statusesForType("question")).not.toContain("planned");
  });
});

describe("isValidStatusChange", () => {
  it("allows closed → open (admin reopen)", () => {
    expect(isValidStatusChange("bug", "closed", "open")).toBe(true);
  });

  it("rejects planned for non-feature-requests", () => {
    expect(isValidStatusChange("bug", "open", "planned")).toBe(false);
    expect(isValidStatusChange("feature_request", "open", "planned")).toBe(true);
  });

  it("rejects no-ops", () => {
    expect(isValidStatusChange("bug", "open", "open")).toBe(false);
  });
});

describe("isTerminalForStaff", () => {
  it("treats closed and declined as terminal", () => {
    expect(isTerminalForStaff("closed")).toBe(true);
    expect(isTerminalForStaff("declined")).toBe(true);
    expect(isTerminalForStaff("resolved")).toBe(false);
    expect(isTerminalForStaff("open")).toBe(false);
  });
});

describe("nextStatusOnStaffReply", () => {
  it("reopens resolved and needs_info", () => {
    expect(nextStatusOnStaffReply("resolved")).toBe("open");
    expect(nextStatusOnStaffReply("needs_info")).toBe("open");
  });

  it("leaves other statuses alone", () => {
    expect(nextStatusOnStaffReply("open")).toBeNull();
    expect(nextStatusOnStaffReply("in_progress")).toBeNull();
    expect(nextStatusOnStaffReply("planned")).toBeNull();
  });
});

describe("statusPatch", () => {
  it("sets resolved_at when entering resolved", () => {
    const patch = statusPatch("in_progress", "resolved", NOW);
    expect(patch).toEqual({ status: "resolved", last_activity_at: NOW, resolved_at: NOW });
  });

  it("preserves resolved_at on resolved → closed", () => {
    const patch = statusPatch("resolved", "closed", NOW);
    expect(patch.resolved_at).toBeUndefined();
    expect(patch.status).toBe("closed");
  });

  it("clears resolved_at when reopening from resolved", () => {
    const patch = statusPatch("resolved", "open", NOW);
    expect(patch.resolved_at).toBeNull();
  });

  it("always bumps last_activity_at", () => {
    expect(statusPatch("open", "in_progress", NOW).last_activity_at).toBe(NOW);
  });
});

describe("shortTicketRef", () => {
  it("uses the first 8 hex chars, uppercased", () => {
    expect(shortTicketRef("3f2a9c1b-1234-5678-9abc-def012345678")).toBe("#3F2A9C1B");
  });
});

describe("buildTicketContext", () => {
  it("truncates long user agents", () => {
    const ctx = buildTicketContext({ userAgent: "x".repeat(400) });
    expect(ctx.user_agent).toHaveLength(250);
  });

  it("nulls missing fields", () => {
    const ctx = buildTicketContext({});
    expect(ctx.org_slug).toBeNull();
    expect(ctx.path).toBeNull();
    expect(ctx.user_agent).toBeNull();
  });
});
