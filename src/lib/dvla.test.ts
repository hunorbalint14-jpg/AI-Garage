import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { lookupVehicle } from "./dvla";

describe("lookupVehicle", () => {
  const origKey = process.env.DVSA_API_KEY;

  beforeEach(() => {
    delete process.env.DVSA_API_KEY;
  });

  afterEach(() => {
    process.env.DVSA_API_KEY = origKey;
  });

  it("returns not-configured error when API key missing", async () => {
    const res = await lookupVehicle("AB12CDE");
    expect(res).toEqual({ success: false, error: "DVSA API key not configured." });
  });
});
