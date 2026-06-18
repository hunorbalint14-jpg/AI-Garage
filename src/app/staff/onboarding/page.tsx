import { redirect } from "next/navigation";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { emptyAnswers, type AiProfileAnswers } from "@/lib/ai-profile";
import { OnboardingForm } from "./onboarding-form";

export const dynamic = "force-dynamic";

// Owner-only AI setup survey. Gates the dashboard on first login (staff/layout
// redirects a not-yet-onboarded owner here) and is also reachable from Settings
// to edit later. Non-owners never see it.
export default async function OnboardingPage() {
  const ctx = await requireStaffContext();
  if (ctx.orgRole !== "owner") redirect("/staff");

  const admin = createAdminClient();
  const { data } = await admin
    .from("organizations")
    .select("ai_profile, ai_brief, ai_onboarded_at")
    .eq("id", ctx.organization.id)
    .maybeSingle();

  const row = data as
    | { ai_profile: AiProfileAnswers | null; ai_brief: string | null; ai_onboarded_at: string | null }
    | null;
  const initial: AiProfileAnswers = { ...emptyAnswers(), ...(row?.ai_profile ?? {}) };

  return (
    <OnboardingForm
      orgName={ctx.organization.name}
      brandColor={ctx.branding.primaryColor ?? "#22c55e"}
      initial={initial}
      brief={row?.ai_brief ?? null}
      isEdit={!!row?.ai_onboarded_at}
    />
  );
}
