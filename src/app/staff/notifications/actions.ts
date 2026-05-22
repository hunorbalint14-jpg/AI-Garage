"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";

export async function markNotificationRead(notificationId: string): Promise<{ success: true } | { error: string }> {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();
  const { error } = await admin
    .from("staff_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("location_id", ctx.location.id)
    .is("read_at", null);
  if (error) return { error: error.message };
  revalidatePath("/staff", "layout");
  return { success: true };
}

export async function markAllNotificationsRead(): Promise<{ success: true } | { error: string }> {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();
  const { error } = await admin
    .from("staff_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("location_id", ctx.location.id)
    .is("read_at", null);
  if (error) return { error: error.message };
  revalidatePath("/staff", "layout");
  return { success: true };
}
