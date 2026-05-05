import { getAccessToken } from "./dvla-auth";

// DVSA MOT History API — OAuth2 client credentials + API key auth

export type DvsaVehicle = {
  registration: string;
  make: string | null;
  model: string | null;
  year: number | null;
  motExpiry: string | null; // YYYY-MM-DD
  colour: string | null;
  noMotHistory: boolean; // true = new vehicle, motExpiry is calculated first-due date
};

export type DvsaResult =
  | { success: true; vehicle: DvsaVehicle }
  | { success: false; error: string };

function parseMotExpiry(tests: { testResult: string; expiryDate?: string }[]): string | null {
  const passed = tests.find((t) => t.testResult?.toUpperCase() === "PASSED" && t.expiryDate);
  return passed?.expiryDate ?? null;
}

function firstMotDueDate(firstUsedDate: string | undefined): string | null {
  if (!firstUsedDate) return null;
  const d = new Date(firstUsedDate);
  if (isNaN(d.getTime())) return null;
  d.setFullYear(d.getFullYear() + 3);
  return d.toISOString().split("T")[0];
}

function parseYear(v: Record<string, unknown>): number | null {
  // Try multiple field names in order of preference
  const raw = (v.firstUsedDate ?? v.registrationDate ?? v.manufactureDate) as string | undefined;
  if (!raw) return null;
  const year = parseInt(String(raw).slice(0, 4), 10);
  return Number.isNaN(year) ? null : year;
}

export async function lookupVehicle(registration: string): Promise<DvsaResult> {
  const apiKey = process.env.DVSA_API_KEY;
  if (!apiKey) return { success: false, error: "DVSA API key not configured." };

  const reg = registration.replace(/\s+/g, "").toUpperCase();

  let token: string;
  try {
    token = await getAccessToken();
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Auth failed." };
  }

  const url = `https://history.mot.api.gov.uk/v1/trade/vehicles/registration/${encodeURIComponent(reg)}`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-API-Key": apiKey,
        Accept: "application/json+v6",
      },
    });
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Network error." };
  }

  if (res.status === 404) return { success: false, error: "Vehicle not found." };
  if (!res.ok) {
    const text = await res.text();
    return { success: false, error: `DVSA API error (${res.status}): ${text.slice(0, 200)}` };
  }

  const vehicle = await res.json() as Record<string, unknown>;
  if (!vehicle) return { success: false, error: "No data returned for this registration." };

  // Debug: log raw fields to server console to help diagnose missing data
  console.log("[DVSA] raw fields:", {
    registration: vehicle.registration,
    make: vehicle.make,
    model: vehicle.model,
    firstUsedDate: vehicle.firstUsedDate,
    registrationDate: vehicle.registrationDate,
    primaryColour: vehicle.primaryColour,
    motTestCount: Array.isArray(vehicle.motTests) ? (vehicle.motTests as unknown[]).length : "n/a",
    latestTestResult: Array.isArray(vehicle.motTests) && (vehicle.motTests as Record<string, unknown>[]).length > 0
      ? (vehicle.motTests as Record<string, unknown>[])[0].testResult : "none",
    latestExpiryDate: Array.isArray(vehicle.motTests) && (vehicle.motTests as Record<string, unknown>[]).length > 0
      ? (vehicle.motTests as Record<string, unknown>[])[0].expiryDate : "none",
  });

  const make = vehicle.make as string | undefined;
  const motTests = Array.isArray(vehicle.motTests)
    ? (vehicle.motTests as { testResult: string; expiryDate?: string }[])
    : [];

  const motExpiry = parseMotExpiry(motTests);
  const noMotHistory = motTests.length === 0;
  const firstUsed = (vehicle.firstUsedDate ?? vehicle.registrationDate) as string | undefined;

  return {
    success: true,
    vehicle: {
      registration: (vehicle.registration as string) ?? reg,
      make: make ? make.charAt(0).toUpperCase() + make.slice(1).toLowerCase() : null,
      model: (vehicle.model as string) ?? null,
      year: parseYear(vehicle),
      motExpiry: motExpiry ?? (noMotHistory ? firstMotDueDate(firstUsed) : null),
      colour: (vehicle.primaryColour as string) ?? null,
      noMotHistory,
    },
  };
}
