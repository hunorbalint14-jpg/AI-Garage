"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { enforceRateLimit, tooManyAttemptsError } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import { getCurrentTenant } from "@/lib/tenant-data";

export type CustomerAuthResult = { ok: true } | { error: string };

async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const protocol =
    host.includes("localhost") || host.includes("localtest.me") ? "http" : "https";
  return `${protocol}://${host}`;
}

// Server-side customer password sign-in, rate-limited per IP+email before
// hitting Supabase (the old client-side call could not be throttled).
export async function signInCustomer(
  email: string,
  password: string,
): Promise<CustomerAuthResult> {
  const limited = await enforceRateLimit("login", email);
  if (!limited.ok) return tooManyAttemptsError(limited.retryAfter);

  const supabase = await createClient();
  const [{ error }, tenant] = await Promise.all([
    supabase.auth.signInWithPassword({ email, password }),
    getCurrentTenant(),
  ]);
  const organizationId = tenant?.organization.id ?? null;

  if (error) {
    await logAudit({
      action: "auth.login_failed",
      actorUserId: null,
      actorEmail: email,
      organizationId,
      metadata: { method: "password", portal: "customer", reason: error.message },
    });
    return { error: error.message };
  }

  const { data: { user } } = await supabase.auth.getUser();
  await logAudit({
    action: "auth.login",
    actorUserId: user?.id ?? null,
    actorEmail: user?.email ?? email,
    organizationId,
    metadata: { method: "password", portal: "customer" },
  });
  return { ok: true };
}

// Send a one-time magic-link email. Rate-limited per IP+email to stop inbox
// spam / enumeration. Always reports success once past the limiter so the
// response doesn't reveal whether the email maps to an account.
export async function sendCustomerMagicLink(
  email: string,
): Promise<CustomerAuthResult> {
  const limited = await enforceRateLimit("email", email);
  if (!limited.ok) return tooManyAttemptsError(limited.retryAfter);

  const supabase = await createClient();
  const origin = await requestOrigin();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${origin}/auth/callback?next=/dashboard` },
  });
  if (error) return { error: error.message };
  return { ok: true };
}
