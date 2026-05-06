"use server";

import { createClient } from "@/lib/supabase/server";
import { runDiagnostic, type DiagnosisResult } from "@/lib/ai-diagnostic";

export type CustomerDiagnosticResult = { error: string } | DiagnosisResult;

export async function runCustomerDiagnostic(
  symptom: string,
  vehicleDescription?: string,
): Promise<CustomerDiagnosticResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };
  if (!symptom.trim()) return { error: "Symptom is required." };

  try {
    return await runDiagnostic(symptom, vehicleDescription);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `Diagnosis failed: ${msg}` };
  }
}
