"use server";

import { createClient } from "@/lib/supabase/server";

export type UpdatePasswordResult = { error: string } | { success: true };

export async function updatePassword(
  formData: FormData,
): Promise<UpdatePasswordResult> {
  const password = formData.get("password") as string | null;
  const confirm = formData.get("confirm") as string | null;

  if (!password || password.length < 6) {
    return { error: "Password must be at least 6 characters." };
  }
  if (password !== confirm) {
    return { error: "Passwords don't match." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });

  if (error) return { error: error.message };
  return { success: true };
}
