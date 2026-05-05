// DVSA MOT History API — OAuth2 client credentials + API key auth

export type DvsaVehicle = {
  registration: string;
  make: string | null;
  model: string | null;
  year: number | null;
  motExpiry: string | null; // YYYY-MM-DD
  colour: string | null;
};

export type DvsaResult =
  | { success: true; vehicle: DvsaVehicle }
  | { success: false; error: string };

// Module-level token cache (warm across requests in same Lambda instance)
let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 30_000) {
    return cachedToken.value;
  }

  const tokenUrl = process.env.DVSA_TOKEN_URL;
  const clientId = process.env.DVSA_CLIENT_ID;
  const clientSecret = process.env.DVSA_CLIENT_SECRET;
  const scope = process.env.DVSA_SCOPE;

  if (!tokenUrl || !clientId || !clientSecret || !scope) {
    throw new Error("DVSA OAuth credentials not configured.");
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope,
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token request failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    value: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  return cachedToken.value;
}

function parseMotExpiry(tests: { testResult: string; expiryDate?: string }[]): string | null {
  // motTests sorted newest first; find most recent passed test
  const passed = tests.find((t) => t.testResult === "PASSED" && t.expiryDate);
  return passed?.expiryDate ?? null; // already YYYY-MM-DD
}

function parseYear(firstUsedDate: string | undefined): number | null {
  if (!firstUsedDate) return null;
  const year = parseInt(firstUsedDate.slice(0, 4), 10); // "YYYY-MM-DD" → take first 4
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

  const vehicle = await res.json();
  if (!vehicle) return { success: false, error: "No data returned for this registration." };

  return {
    success: true,
    vehicle: {
      registration: vehicle.registration ?? reg,
      make: vehicle.make ? (vehicle.make as string).charAt(0) + (vehicle.make as string).slice(1).toLowerCase() : null,
      model: vehicle.model ?? null,
      year: parseYear(vehicle.firstUsedDate),
      motExpiry: parseMotExpiry(vehicle.motTests ?? []),
      colour: vehicle.primaryColour ?? null,
    },
  };
}
