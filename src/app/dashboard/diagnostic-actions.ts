"use server";

import { createClient } from "@/lib/supabase/server";
import { runDiagnostic, type DiagnosisResult } from "@/lib/ai-diagnostic";
import { enforceRateLimit, tooManyAttemptsError } from "@/lib/rate-limit";
import { getCurrentTenant } from "@/lib/tenant-data";

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

  // Attribute AI usage to the tenant whose portal this is (org derived from
  // location in the overview view). Tenant is resolved from the subdomain.
  const tenant = await getCurrentTenant();

  try {
    return await runDiagnostic(
      symptom,
      vehicleDescription,
      tenant
        ? { locationId: tenant.location.id, organizationId: tenant.organization.id, userId: user.id, feature: "diagnostic_customer" }
        : undefined,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `Diagnosis failed: ${msg}` };
  }
}
