// DVSA Vehicle Recalls API
// Apply for access at: https://api.gov.uk/catalogue/vehicle-recalls
// Add env var: DVSA_RECALLS_API_KEY

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
  const apiKey = process.env.DVSA_RECALLS_API_KEY;
  if (!apiKey) return { success: false, error: "Recall checker not configured. Add DVSA_RECALLS_API_KEY." };

  const reg = registration.replace(/\s+/g, "").toUpperCase();

  try {
    const res = await fetch(
      `https://driver-vehicle-licensing.api.gov.uk/vehicle-recalls/v1/recall/${encodeURIComponent(reg)}`,
      {
        headers: {
          "x-api-key": apiKey,
          Accept: "application/json",
        },
      },
    );

    if (res.status === 404) return { success: true, hasRecall: false, recalls: [] };
    if (res.status === 204) return { success: true, hasRecall: false, recalls: [] };

    if (!res.ok) {
      const text = await res.text();
      return { success: false, error: `Recalls API error (${res.status}): ${text.slice(0, 200)}` };
    }

    const data = await res.json();

    // API may return array of recalls or object with recalls array
    const items: Record<string, string>[] = Array.isArray(data)
      ? data
      : Array.isArray(data.recalls)
      ? data.recalls
      : [];

    const recalls: Recall[] = items.map((r) => ({
      makeModel: r.makeModel ?? r.make_model ?? "",
      recallNumber: r.recallNumber ?? r.recall_number ?? "",
      defectDescription: r.defectDescription ?? r.defect_description ?? "",
      remedyDescription: r.remedyDescription ?? r.remedy_description ?? "",
      recallDate: r.recallDate ?? r.recall_date ?? "",
    }));

    return { success: true, hasRecall: recalls.length > 0, recalls };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Network error." };
  }
}
