import { describe, it, expect, beforeAll } from "vitest";
import { makeSessionStartValue, readSessionStart } from "./session-cookie";

beforeAll(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-session-signing-secret";
});

describe("session-cookie signing", () => {
  it("round-trips a signed timestamp", async () => {
    const now = 1_700_000_000_000;
    const value = await makeSessionStartValue(now);
    expect(value).toMatch(/^\d+\.[0-9a-f]+$/);
    expect(await readSessionStart(value)).toBe(now);
  });

  it("rejects a tampered timestamp (sig no longer matches)", async () => {
    const value = await makeSessionStartValue(1_700_000_000_000);
    const sig = value.split(".")[1];
    const forged = `9999999999999.${sig}`;
    expect(await readSessionStart(forged)).toBeNull();
  });

  it("rejects a legacy unsigned value", async () => {
    expect(await readSessionStart("1700000000000")).toBeNull();
  });

  it("rejects absent/empty input", async () => {
    expect(await readSessionStart(null)).toBeNull();
    expect(await readSessionStart(undefined)).toBeNull();
    expect(await readSessionStart("")).toBeNull();
    expect(await readSessionStart(".abc")).toBeNull();
  });
});
