import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { signOAuthState, verifyOAuthState } from "./oauth-state";

describe("oauth-state", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sign + verify round-trip returns orgId + userId", () => {
    const token = signOAuthState({ orgId: "o_1", userId: "u_2" });
    const verified = verifyOAuthState(token);
    expect(verified).toEqual({ ok: true, orgId: "o_1", userId: "u_2" });
  });

  it("rejects expired token (>10min old)", () => {
    const token = signOAuthState({ orgId: "o_1", userId: "u_2" });
    vi.setSystemTime(new Date("2026-06-01T12:11:00Z"));
    expect(verifyOAuthState(token)).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects token with bad signature", () => {
    const token = signOAuthState({ orgId: "o_1", userId: "u_2" });
    // Replace the entire signature segment with a clearly-wrong value of the
    // right shape, so the comparison runs but fails on content (not on length).
    const [payload] = token.split(".");
    const tampered = `${payload}.${"A".repeat(43)}`;
    const res = verifyOAuthState(tampered);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(["bad-sig", "malformed"]).toContain(res.reason);
  });

  it("rejects malformed string (no dot)", () => {
    expect(verifyOAuthState("nodothere")).toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects malformed payload (junk base64)", () => {
    // valid-shape sig but payload is not JSON
    const fakePayload = Buffer.from("not-json").toString("base64url");
    const fakeSig = Buffer.from("nope").toString("base64url");
    const res = verifyOAuthState(`${fakePayload}.${fakeSig}`);
    expect(res.ok).toBe(false);
  });
});
