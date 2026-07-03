"use server";

import { requireStaffContext } from "@/lib/staff-context";
import { hasPermission } from "@/lib/permissions";
import { enforceRateLimit, tooManyAttemptsError } from "@/lib/rate-limit";
import { runDiagnostic, type DiagnosisResult } from "@/lib/ai-diagnostic";
import { estimateLabourTime } from "@/lib/ai-labour";

// Phase 9 (#251): AI-assisted quote drafting. Suggestions only — staff review
// and edit everything before saving/sending; nothing here writes to the DB.

const AI_TIMEOUT_MS = 15_000;

function withTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("AI timed out")), AI_TIMEOUT_MS),
    ),
  ]);
}

export type SeedFromDiagnosticResult =
  | { error: string }
  | {
      success: true;
      title: string;
      customerMessage: string;
      items: { description: string; type: "labour"; quantity: number; unit_price: number; note: string }[];
      diagnosis: DiagnosisResult;
    };

// Runs the AI diagnostic on a symptom the staff member types into the quote
// builder, then estimates labour for the recommended action — returning a
// draft title, customer message, and starter line item to prefill the form.
export async function seedQuoteFromDiagnostic(args: {
  symptom: string;
  vehicleDescription?: string;
  vehicleReg?: string;
}): Promise<SeedFromDiagnosticResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "quotes_draft")) return { error: "Permission denied." };
  const symptom = args.symptom?.trim();
  if (!symptom) return { error: "Describe the symptom first." };

  const limited = await enforceRateLimit("ai", ctx.user.id);
  if (!limited.ok) return tooManyAttemptsError(limited.retryAfter);

  const usage = {
    locationId: ctx.location.id,
    organizationId: ctx.organization.id,
    userId: ctx.user.id,
    feature: "quote_seed_diagnostic",
  };

  try {
    const diagnosis = await withTimeout(runDiagnostic(symptom, args.vehicleDescription, usage));
    const { hours, note } = await withTimeout(
      estimateLabourTime(diagnosis.recommendedAction, args.vehicleDescription, usage),
    );

    return {
      success: true,
      title: args.vehicleReg ? `Diagnostic findings — ${args.vehicleReg}` : "Diagnostic findings",
      customerMessage: `${diagnosis.urgencyNote} Recommended: ${diagnosis.recommendedAction}`,
      items: [
        {
          description: diagnosis.recommendedAction,
          type: "labour",
          quantity: hours,
          unit_price: 0,
          note,
        },
      ],
      diagnosis,
    };
  } catch {
    return { error: "AI suggestion unavailable right now — build the quote manually." };
  }
}
