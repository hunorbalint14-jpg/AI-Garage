"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";

export type ActionResult = { error: string } | { success: true };

// Update the signed-in user's display name (auth user_metadata.full_name).
export async function updateProfileName(name: string): Promise<ActionResult> {
  const ctx = await requireStaffContext();
  const trimmed = name.trim();
  if (!trimmed) return { error: "Name can't be empty." };
  if (trimmed.length > 80) return { error: "Name is too long." };

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(ctx.user.id, {
    user_metadata: { full_name: trimmed },
  });
  if (error) return { error: "Could not update your name. Please try again." };
  revalidatePath("/staff/account");
  return { success: true };
}

// Change the signed-in user's password. Verifies the current password first via
// a throwaway client (so the live session cookie is untouched), then sets the
// new password with the service-role admin client.
export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<ActionResult> {
  const ctx = await requireStaffContext();
  if (!ctx.user.email) return { error: "No email on your account." };
  if (newPassword.length < 8) return { error: "New password must be at least 8 characters." };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return { error: "Authentication is not configured." };

  const verifier = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signInErr } = await verifier.auth.signInWithPassword({
    email: ctx.user.email,
    password: currentPassword,
  });
  if (signInErr) return { error: "Current password is incorrect." };
  await verifier.auth.signOut();

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(ctx.user.id, { password: newPassword });
  if (error) return { error: "Could not update your password. Please try again." };
  return { success: true };
}

// Save the signed-in user's notification preferences.
export async function updateDigestPref(enabled: boolean): Promise<ActionResult> {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();
  const { error } = await admin
    .from("staff_notification_prefs")
    .upsert(
      { user_id: ctx.user.id, weekly_digest: enabled, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
  if (error) return { error: "Could not save your preference. Please try again." };
  revalidatePath("/staff/account");
  return { success: true };
}
