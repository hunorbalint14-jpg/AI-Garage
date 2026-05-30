import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// In-memory stand-in for the password_reset_tokens table. insert() rejects a
// jti it has already seen with a Postgres unique-violation, mirroring the PK.
const consumed = new Set<string>();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      insert: (row: { jti: string }) => {
        if (consumed.has(row.jti)) return Promise.resolve({ error: { code: "23505" } });
        consumed.add(row.jti);
        return Promise.resolve({ error: null });
      },
    }),
  }),
}));

const { signResetToken, consumeResetToken } = await import("./reset-token");

beforeEach(() => {
  consumed.clear();
  process.env.RESET_TOKEN_SECRET = "test-reset-secret";
});
afterEach(() => vi.useRealTimers());

describe("reset-token single-use", () => {
  it("consumes a freshly signed token once", async () => {
    const token = signResetToken("user_1");
    expect(await consumeResetToken(token)).toEqual({ uid: "user_1" });
  });

  it("rejects a second use of the same token", async () => {
    const token = signResetToken("user_1");
    expect(await consumeResetToken(token)).toEqual({ uid: "user_1" });
    expect(await consumeResetToken(token)).toBeNull();
  });

  it("rejects a tampered signature", async () => {
    const token = signResetToken("user_1");
    const json = JSON.parse(Buffer.from(token, "base64url").toString());
    json.sig = "0".repeat(64);
    const forged = Buffer.from(JSON.stringify(json)).toString("base64url");
    expect(await consumeResetToken(forged)).toBeNull();
  });

  it("rejects a uid swap (sig bound to uid)", async () => {
    const token = signResetToken("user_1");
    const json = JSON.parse(Buffer.from(token, "base64url").toString());
    json.uid = "attacker";
    const forged = Buffer.from(JSON.stringify(json)).toString("base64url");
    expect(await consumeResetToken(forged)).toBeNull();
  });

  it("rejects an expired token", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const token = signResetToken("user_1");
    vi.setSystemTime(11 * 60 * 1000); // past the 10-minute TTL
    expect(await consumeResetToken(token)).toBeNull();
  });

  it("rejects malformed input", async () => {
    expect(await consumeResetToken("not-base64url-json")).toBeNull();
  });
});
