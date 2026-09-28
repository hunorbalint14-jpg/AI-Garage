import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { lookupVehicle, firstMotDueDate, fetchDvsaVehicleRecord } from "./dvla";

vi.mock("./dvla-auth", () => ({ getAccessToken: vi.fn().mockResolvedValue("test-token") }));

// Both names are accepted (src/lib/dvsa-api-key.ts), and vitest.setup.ts
// pre-sets the legacy one — so "no key" tests must clear both. Restore by
// deleting rather than assigning: `process.env.X = undefined` stores the
// string "undefined", which would read as a configured key.
const KEY_NAMES = ["DVSA_API_KEY", "DVSA_MOT_API_KEY"] as const;
const savedKeys = Object.fromEntries(KEY_NAMES.map((k) => [k, process.env[k]]));
function clearDvsaKeys() {
  for (const k of KEY_NAMES) delete process.env[k];
}
function restoreDvsaKeys() {
  for (const k of KEY_NAMES) {
    if (savedKeys[k] === undefined) delete process.env[k];
    else process.env[k] = savedKeys[k];
  }
}

describe("firstMotDueDate", () => {
  it("adds three years to the first-used date", () => {
    expect(firstMotDueDate("2023-07-04")).toBe("2026-07-04");
  });

  it("normalises legacy dotted dates", () => {
    expect(firstMotDueDate("2023.07.04")).toBe("2026-07-04");
  });

  it("clamps a leap-day registration to 28 Feb in non-leap years", () => {
    expect(firstMotDueDate("2024-02-29")).toBe("2027-02-28");
  });

  it("returns null for missing or garbage input", () => {
    expect(firstMotDueDate(undefined)).toBeNull();
    expect(firstMotDueDate("not a date")).toBeNull();
  });
});

describe("lookupVehicle", () => {
  beforeEach(clearDvsaKeys);

  afterEach(() => {
    restoreDvsaKeys();
    vi.unstubAllGlobals();
  });

  function stubDvsaResponse(body: Record<string, unknown>) {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
  }

  it("returns not-configured error when API key missing", async () => {
    const res = await lookupVehicle("AB12CDE");
    expect(res).toEqual({ success: false, error: "DVSA API key not configured." });
  });

  it("prefers DVSA's motTestDueDate for never-tested vehicles", async () => {
    process.env.DVSA_API_KEY = "test-key";
    // NewRegVehicleResponse shape: no motTests, no firstUsedDate. The due
    // date deliberately disagrees with registrationDate + 3y (import case).
    stubDvsaResponse({
      registration: "LC74XYZ",
      make: "TOYOTA",
      model: "SUPRA",
      registrationDate: "2024-11-15",
      manufactureDate: "2023-06-01",
      motTestDueDate: "2026-06-01",
      primaryColour: "White",
    });

    const res = await lookupVehicle("LC74 XYZ");
    expect(res).toMatchObject({
      success: true,
      vehicle: { motExpiry: "2026-06-01", noMotHistory: true },
    });
  });

  it("falls back to registration + 3 years when motTestDueDate is absent", async () => {
    process.env.DVSA_API_KEY = "test-key";
    stubDvsaResponse({
      registration: "LC74XYZ",
      make: "FORD",
      model: "PUMA",
      registrationDate: "2024-11-15",
      primaryColour: "Blue",
    });

    const res = await lookupVehicle("LC74 XYZ");
    expect(res).toMatchObject({
      success: true,
      vehicle: { motExpiry: "2027-11-15", noMotHistory: true },
    });
  });

  it("uses the latest passed test expiry for tested vehicles, ignoring motTestDueDate", async () => {
    process.env.DVSA_API_KEY = "test-key";
    stubDvsaResponse({
      registration: "AB12CDE",
      make: "VOLKSWAGEN",
      model: "GOLF",
      firstUsedDate: "2019-03-01",
      motTests: [
        { completedDate: "2026-02-10T10:00:00Z", testResult: "PASSED", expiryDate: "2027-02-09" },
        { completedDate: "2025-02-01T10:00:00Z", testResult: "PASSED", expiryDate: "2026-02-01" },
      ],
    });

    const res = await lookupVehicle("AB12CDE");
    expect(res).toMatchObject({
      success: true,
      vehicle: { motExpiry: "2027-02-09", noMotHistory: false },
    });
  });

  it("accepts the key under its legacy DVSA_MOT_API_KEY name", async () => {
    // The env docs named it DVSA_MOT_API_KEY while the code read DVSA_API_KEY,
    // so an environment set up from the docs failed every lookup.
    process.env.DVSA_MOT_API_KEY = "legacy-key";
    stubDvsaResponse({ registration: "AB12CDE", make: "FORD", motTests: [] });

    const res = await lookupVehicle("AB12CDE");

    expect(res.success).toBe(true);
    const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)["X-API-Key"]).toBe("legacy-key");
  });
});

describe("fetchDvsaVehicleRecord", () => {
  beforeEach(() => {
    clearDvsaKeys();
    process.env.DVSA_API_KEY = "test-key";
  });

  afterEach(() => {
    restoreDvsaKeys();
    vi.unstubAllGlobals();
  });

  const respond = (status: number, body: unknown = {}) =>
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })));

  it("returns the raw record for a known registration", async () => {
    respond(200, { registration: "AB12CDE", motTests: [] });
    expect(await fetchDvsaVehicleRecord("ab12 cde")).toEqual({
      status: "ok",
      record: { registration: "AB12CDE", motTests: [] },
    });
  });

  it.each([404, 400])("treats %i as not found — it won't resolve on retry", async (status) => {
    respond(status);
    expect(await fetchDvsaVehicleRecord("AB12CDE")).toEqual({ status: "not_found" });
  });

  it.each([401, 403, 429])("treats %i as systemic — the next registration would fail too", async (status) => {
    respond(status);
    expect((await fetchDvsaVehicleRecord("AB12CDE")).status).toBe("systemic");
  });

  it("treats a 5xx as this registration's problem only", async () => {
    respond(503);
    expect((await fetchDvsaVehicleRecord("AB12CDE")).status).toBe("error");
  });

  it("is systemic when no key is configured under either name", async () => {
    clearDvsaKeys();
    expect(await fetchDvsaVehicleRecord("AB12CDE")).toEqual({
      status: "systemic",
      error: "DVSA API key not configured.",
    });
  });
});
