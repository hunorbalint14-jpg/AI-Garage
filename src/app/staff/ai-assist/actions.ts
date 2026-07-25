"use server";

import { requireStaffContext } from "@/lib/staff-context";
import { enforceRateLimit, tooManyAttemptsError } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { assistRewrite } from "@/lib/ai-assist";
import { ASSIST_MAX_INSTRUCTION, ASSIST_MAX_TEXT, type AssistChannel } from "@/lib/ai-assist-shared";

export type AssistRewriteResult = { error: string } | { text: string };

// Generic "rewrite my draft" action behind every AI-assist menu. Deliberately
// not gated on a feature permission: it only transforms text the staff member
// has already typed — the send actions keep their own permission checks.
export async function rewriteWithAssist(input: {
  text: string;
  instruction: string;
  channel: AssistChannel;
}): Promise<AssistRewriteResult> {
  const ctx = await requireStaffContext();

  const text = input.text?.trim();
  const instruction = input.instruction?.trim().slice(0, ASSIST_MAX_INSTRUCTION);
  const channel: AssistChannel =
    input.channel === "sms" ? "sms" : input.channel === "email" ? "email" : "generic";

  if (!text) return { error: "Write a message first — AI assist rewrites your text." };
  if (!instruction) return { error: "No instruction given." };
  if (text.length > ASSIST_MAX_TEXT) {
    return { error: `Message too long to rewrite (max ${ASSIST_MAX_TEXT} characters).` };
  }

  const limited = await enforceRateLimit("ai", ctx.user.id);
  if (!limited.ok) return tooManyAttemptsError(limited.retryAfter);

  const admin = createAdminClient();
  const { data: org } = await admin
    .from("organizations")
    .select("name, ai_brief")
    .eq("id", ctx.organization.id)
    .maybeSingle();

  try {
    const rewritten = await assistRewrite(
      {
        text,
        instruction,
        channel,
        garageName: (org as { name: string | null } | null)?.name ?? ctx.organization.name,
        aiBrief: (org as { ai_brief?: string | null } | null)?.ai_brief ?? null,
      },
      {
        locationId: ctx.location.id,
        organizationId: ctx.organization.id,
        userId: ctx.user.id,
        feature: "ai_assist_rewrite",
      },
    );
    return { text: rewritten };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `AI assist failed: ${msg}` };
  }
}
