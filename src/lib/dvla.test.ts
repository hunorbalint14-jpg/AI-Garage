import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { lookupVehicle, firstMotDueDate } from "./dvla";

vi.mock("./dvla-auth", () => ({ getAccessToken: vi.fn().mockResolvedValue("test-token") }));

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
  const origKey = process.env.DVSA_API_KEY;

  beforeEach(() => {
    delete process.env.DVSA_API_KEY;
  });

  afterEach(() => {
    process.env.DVSA_API_KEY = origKey;
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
});
