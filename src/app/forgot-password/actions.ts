"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { enforceRateLimit, tooManyAttemptsError } from "@/lib/rate-limit";

export type ForgotPasswordResult = { ok: true } | { error: string };

// Send a password-reset email, rate-limited per IP+email so the endpoint can't
// be used to spam a victim's inbox or as an oracle. resetPasswordForEmail does
// not reveal whether the address exists, so we surface a generic success.
export async function requestPasswordReset(
  email: string,
): Promise<ForgotPasswordResult> {
  const limited = await enforceRateLimit("email", email);
  if (!limited.ok) return tooManyAttemptsError(limited.retryAfter);

  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const protocol =
    host.includes("localhost") || host.includes("localtest.me") ? "http" : "https";
  const origin = `${protocol}://${host}`;

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=/reset-password`,
  });
  if (error) return { error: error.message };
  return { ok: true };
}
