"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext, invalidateStaffLocationCacheForOrg } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { generateAiBrief, emptyAnswers, type AiProfileAnswers } from "@/lib/ai-profile";

export type OnboardingResult = { error: string } | { success: true };

// Normalise client input into the AiProfileAnswers shape — never trust the raw
// object. Arrays are string[], strings are trimmed + length-capped.
function coerceAnswers(raw: unknown): AiProfileAnswers {
  const base = emptyAnswers();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Record<string, unknown>;
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((s) => s.slice(0, 120)).slice(0, 40) : [];
  const str = (v: unknown): string => (typeof v === "string" ? v.trim().slice(0, 1000) : "");
  return {
    specialisms: arr(r.specialisms),
    marques: str(r.marques),
    tone: str(r.tone) || base.tone,
    services: arr(r.services),
    signatureServices: str(r.signatureServices),
    amenities: arr(r.amenities),
    leadTime: str(r.leadTime),
    diagnostics: arr(r.diagnostics),
    doesNotDo: str(r.doesNotDo),
    partsPolicy: str(r.partsPolicy),
    tyres: str(r.tyres),
    bookingPreference: str(r.bookingPreference) || base.bookingPreference,
    promotions: str(r.promotions),
    receptionistStyle: str(r.receptionistStyle),
    escalation: str(r.escalation),
    neverSay: str(r.neverSay),
    extraNotes: str(r.extraNotes),
  };
}

// Owner-only. Stores the survey, generates the AI brief, and stamps
// ai_onboarded_at (which lifts the dashboard gate). Used for both first-run and
// later edits from Settings.
export async function saveOnboarding(raw: unknown): Promise<OnboardingResult> {
  const ctx = await requireStaffContext();
  if (ctx.orgRole !== "owner") return { error: "Only the owner can complete AI setup." };

  const answers = coerceAnswers(raw);
  const admin = createAdminClient();

  // Generate the brief; never block setup on an AI hiccup — store answers
  // regardless and keep any previous brief if generation fails.
  let brief: string | null = null;
  try {
    brief = await generateAiBrief(ctx.organization.name, answers, {
      organizationId: ctx.organization.id,
      locationId: ctx.location.id,
      userId: ctx.user.id,
      feature: "ai_profile_brief",
    });
  } catch (e) {
    console.error("[onboarding] brief generation failed", e);
  }

  const update: Record<string, unknown> = {
    ai_profile: answers as unknown as Record<string, unknown>,
    ai_onboarded_at: new Date().toISOString(),
  };
  if (brief) update.ai_brief = brief;

  const { error } = await admin.from("organizations").update(update).eq("id", ctx.organization.id);
  if (error) return { error: error.message };

  await invalidateStaffLocationCacheForOrg(ctx.organization.id);

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "settings.ai_profile_update",
    entityType: "organization",
    entityId: ctx.organization.id,
    metadata: { brief_generated: !!brief },
  });

  revalidatePath("/staff");
  revalidatePath("/staff/settings");
  return { success: true };
}
