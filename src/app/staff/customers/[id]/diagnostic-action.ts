"use server";

import { requireStaffContext } from "@/lib/staff-context";
import { runDiagnostic, type DiagnosisResult } from "@/lib/ai-diagnostic";
import { enforceRateLimit, tooManyAttemptsError } from "@/lib/rate-limit";

export type StaffDiagnosticResult = { error: string } | DiagnosisResult;

export async function runStaffDiagnostic(
  symptom: string,
  vehicleDescription?: string,
): Promise<StaffDiagnosticResult> {
  const ctx = await requireStaffContext();
  if (!symptom.trim()) return { error: "Symptom is required." };

  const limited = await enforceRateLimit("ai", ctx.user.id);
  if (!limited.ok) return tooManyAttemptsError(limited.retryAfter);

  try {
    return await runDiagnostic(symptom, vehicleDescription);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `Diagnosis failed: ${msg}` };
  }
}
