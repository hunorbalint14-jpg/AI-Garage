// DVLA Vehicle Enquiry Service (VES) API
// Apply at: https://developer-portal.driver-vehicle-licensing.api.gov.uk/
// Add env var: DVLA_VES_API_KEY

export type VesResult =
  | { success: true; taxDueDate: string | null; taxStatus: string | null; motExpiryDate: string | null }
  | { success: false; error: string };

export async function lookupVehicleVes(registration: string): Promise<VesResult> {
  const apiKey = process.env.DVLA_VES_API_KEY;
  if (!apiKey) return { success: false, error: "DVLA VES API key not configured. Add DVLA_VES_API_KEY to .env.local." };

  const reg = registration.replace(/\s+/g, "").toUpperCase();

  try {
    const res = await fetch(
      "https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles",
      {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ registrationNumber: reg }),
      },
    );

    if (res.status === 404) return { success: false, error: "Vehicle not found." };
    if (!res.ok) {
      const text = await res.text();
      return { success: false, error: `VES API error (${res.status}): ${text.slice(0, 200)}` };
    }

    const data = await res.json() as Record<string, unknown>;

    // VES response fields: taxDueDate (YYYY-MM-DD), taxStatus ("Taxed"/"SORN"/"Untaxed"), motExpiryDate (YYYY-MM-DD)
    return {
      success: true,
      taxDueDate: (data.taxDueDate as string | undefined) ?? null,
      taxStatus: (data.taxStatus as string | undefined) ?? null,
      motExpiryDate: (data.motExpiryDate as string | undefined) ?? null,
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Network error." };
  }
}
