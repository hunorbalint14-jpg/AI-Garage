// DVSA Vehicle Recalls — data comes from the MOT History API (same credentials)
// The MOT History API at history.mot.api.gov.uk includes recall information.

import { getAccessToken } from "./dvla-auth";

export type RecallResult =
  | { success: true; hasRecall: boolean; recalls: Recall[] }
  | { success: false; error: string };

export type Recall = {
  makeModel: string;
  recallNumber: string;
  defectDescription: string;
  remedyDescription: string;
  recallDate: string;
};

export async function checkVehicleRecalls(registration: string): Promise<RecallResult> {
  const apiKey = process.env.DVSA_API_KEY;
  if (!apiKey) return { success: false, error: "DVSA API key not configured." };

  const reg = registration.replace(/\s+/g, "").toUpperCase();

  let token: string;
  try {
    token = await getAccessToken();
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Auth failed." };
  }

  try {
    const res = await fetch(
      `https://history.mot.api.gov.uk/v1/trade/vehicles/registration/${encodeURIComponent(reg)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-API-Key": apiKey,
          Accept: "application/json+v6",
        },
      },
    );

    if (res.status === 404) return { success: true, hasRecall: false, recalls: [] };
    if (!res.ok) {
      const text = await res.text();
      return { success: false, error: `API error (${res.status}): ${text.slice(0, 200)}` };
    }

    const vehicle = await res.json() as Record<string, unknown>;

    // Log all top-level fields so we can see recall field names
    console.log("[recall check] top-level fields:", Object.keys(vehicle));
    console.log("[recall check] recall-related:", {
      hasOutstandingRecall: vehicle.hasOutstandingRecall,
      recalls: vehicle.recalls,
      recallStatus: vehicle.recallStatus,
      recallCampaignRef: vehicle.recallCampaignRef,
      outstandingRecalls: vehicle.outstandingRecalls,
    });

    // API returns hasOutstandingRecall as string "Yes"/"No" or boolean
    const flag = vehicle.hasOutstandingRecall;
    const hasOutstanding =
      flag === "Yes" ||
      flag === true ||
      flag === "yes" ||
      (Array.isArray(vehicle.recalls) && (vehicle.recalls as unknown[]).length > 0) ||
      (Array.isArray(vehicle.outstandingRecalls) && (vehicle.outstandingRecalls as unknown[]).length > 0);

    // API only returns the flag — no detail array. Build a single recall entry if outstanding.
    const recalls: Recall[] = hasOutstanding
      ? [{
          makeModel: `${vehicle.make ?? ""} ${vehicle.model ?? ""}`.trim(),
          recallNumber: "",
          defectDescription: "Outstanding safety recall on file. Check the DVSA website for full details.",
          remedyDescription: "",
          recallDate: "",
        }]
      : [];

    return { success: true, hasRecall: hasOutstanding, recalls };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Network error." };
  }
}
