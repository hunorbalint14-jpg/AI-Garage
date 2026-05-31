"use server";

import { createClient } from "@/lib/supabase/server";
import { runDiagnostic, type DiagnosisResult } from "@/lib/ai-diagnostic";
import { enforceRateLimit, tooManyAttemptsError } from "@/lib/rate-limit";

export type CustomerDiagnosticResult = { error: string } | DiagnosisResult;

export async function runCustomerDiagnostic(
  symptom: string,
  vehicleDescription?: string,
): Promise<CustomerDiagnosticResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };
  if (!symptom.trim()) return { error: "Symptom is required." };

  // Cap Anthropic calls per user to prevent cost-DoS from a cheap account.
  const limited = await enforceRateLimit("ai", user.id);
  if (!limited.ok) return tooManyAttemptsError(limited.retryAfter);

  try {
    return await runDiagnostic(symptom, vehicleDescription);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `Diagnosis failed: ${msg}` };
  }
}
