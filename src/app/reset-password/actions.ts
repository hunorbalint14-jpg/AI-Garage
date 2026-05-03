"use server";

import { createHmac } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

const RESET_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

function verifyResetToken(token: string): { uid: string } | null {
  try {
    const { uid, ts, sig } = JSON.parse(
      Buffer.from(token, "base64url").toString(),
    );
    if (!uid || !ts || !sig) return null;
    if (Date.now() - parseInt(ts) > RESET_EXPIRY_MS) return null;

    const secret = process.env.CRON_SECRET ?? "dev-reset-secret";
    const expected = createHmac("sha256", secret)
      .update(`${uid}:${ts}`)
      .digest("hex");
    if (sig !== expected) return null;

    return { uid };
  } catch {
    return null;
  }
}

export type UpdatePasswordResult = { error: string } | { success: true };

export async function updatePassword(
  formData: FormData,
): Promise<UpdatePasswordResult> {
  const token = formData.get("token") as string | null;
  const password = formData.get("password") as string | null;
  const confirm = formData.get("confirm") as string | null;

  if (!token) return { error: "Missing reset token." };
  if (!password || password.length < 6)
    return { error: "Password must be at least 6 characters." };
  if (password !== confirm) return { error: "Passwords don't match." };

  const payload = verifyResetToken(token);
  if (!payload)
    return {
      error:
        "Reset link has expired or is invalid. Please request a new one.",
    };

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(payload.uid, {
    password,
  });

  if (error) return { error: error.message };
  return { success: true };
}
