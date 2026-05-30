"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth-constants";
import { enforceRateLimit, tooManyAttemptsError } from "@/lib/rate-limit";
import { consumeResetToken } from "@/lib/reset-token";

export type UpdatePasswordResult = { error: string } | { success: true };

export async function updatePassword(
  formData: FormData,
): Promise<UpdatePasswordResult> {
  const limited = await enforceRateLimit("login");
  if (!limited.ok) return tooManyAttemptsError(limited.retryAfter);

  const token = formData.get("token") as string | null;
  const password = formData.get("password") as string | null;
  const confirm = formData.get("confirm") as string | null;

  if (!token) return { error: "Missing reset token." };
  if (!password || password.length < MIN_PASSWORD_LENGTH)
    return { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  if (password !== confirm) return { error: "Passwords don't match." };

  const payload = await consumeResetToken(token);
  if (!payload)
    return {
      error:
        "Reset link has expired, was already used, or is invalid. Please request a new one.",
    };

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(payload.uid, {
    password,
  });

  if (error) return { error: error.message };
  return { success: true };
}
