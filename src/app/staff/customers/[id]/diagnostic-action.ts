"use server";

import { requireStaffContext } from "@/lib/staff-context";
import { runDiagnostic, type DiagnosisResult } from "@/lib/ai-diagnostic";

export type StaffDiagnosticResult = { error: string } | DiagnosisResult;

export async function runStaffDiagnostic(
  symptom: string,
  vehicleDescription?: string,
): Promise<StaffDiagnosticResult> {
  await requireStaffContext();
  if (!symptom.trim()) return { error: "Symptom is required." };

  try {
    return await runDiagnostic(symptom, vehicleDescription);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `Diagnosis failed: ${msg}` };
  }
}
