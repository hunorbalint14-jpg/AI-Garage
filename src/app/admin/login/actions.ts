"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { enforceRateLimit, tooManyAttemptsError } from "@/lib/rate-limit";
import { isPlatformAdminUser } from "@/lib/platform-admin";
import { logAudit } from "@/lib/audit";

// Platform-operator sign-in. Same rate-limited password flow as staff login,
// but gated by the PLATFORM_ADMIN_EMAILS allowlist: a non-operator who knows a
// valid Supabase password is signed straight back out and refused, so this
// screen can't be used as a generic login.
export async function signInPlatformAdmin(
  email: string,
  password: string,
): Promise<{ ok: true } | { error: string }> {
  const limited = await enforceRateLimit("login", email);
  if (!limited.ok) return tooManyAttemptsError(limited.retryAfter);

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    await logAudit({
      action: "auth.login_failed",
      actorEmail: email,
      metadata: { portal: "platform", reason: error.message },
    });
    return { error: error.message };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Authorise against the env allowlist OR the platform_admins table. A valid
  // Supabase password for a non-operator account is signed straight back out.
  if (!(await isPlatformAdminUser(user))) {
    await supabase.auth.signOut();
    await logAudit({
      action: "auth.login_failed",
      actorUserId: user?.id ?? null,
      actorEmail: user?.email ?? email,
      metadata: { portal: "platform", reason: "not_authorised" },
    });
    return { error: "Not authorised." };
  }

  await logAudit({
    action: "auth.login",
    actorUserId: user?.id ?? null,
    actorEmail: user?.email ?? email,
    metadata: { portal: "platform" },
  });

  return { ok: true };
}

export async function signOutPlatformAdmin(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/admin/login");
}
