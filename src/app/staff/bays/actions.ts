"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { hasPermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";

export type BayResult = { error: string } | { success: true };

export async function createBay(formData: FormData): Promise<BayResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "bays")) {
    return { error: "Permission denied." };
  }

  const name = (formData.get("name") as string | null)?.trim();
  const description = (formData.get("description") as string | null)?.trim() || null;
  if (!name) return { error: "Bay name is required." };

  const admin = createAdminClient();
  const { count } = await admin
    .from("bays")
    .select("id", { count: "exact", head: true })
    .eq("location_id", ctx.location.id);

  const { error } = await admin.from("bays").insert({
    location_id: ctx.location.id,
    name,
    description,
    sort_order: (count ?? 0),
  });
  if (error) return { error: error.message };

  revalidatePath("/staff/bays");
  revalidatePath("/staff");
  return { success: true };
}

export async function deleteBay(bayId: string): Promise<BayResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "bays")) {
    return { error: "Permission denied." };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("bays")
    .delete()
    .eq("id", bayId)
    .eq("location_id", ctx.location.id);
  if (error) return { error: error.message };

  revalidatePath("/staff/bays");
  revalidatePath("/staff");
  return { success: true };
}

export async function updateBay(bayId: string, formData: FormData): Promise<BayResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "bays")) {
    return { error: "Permission denied." };
  }

  const name = (formData.get("name") as string | null)?.trim();
  const description = (formData.get("description") as string | null)?.trim() || null;
  if (!name) return { error: "Bay name is required." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("bays")
    .update({ name, description })
    .eq("id", bayId)
    .eq("location_id", ctx.location.id);
  if (error) return { error: error.message };

  revalidatePath("/staff/bays");
  revalidatePath("/staff");
  return { success: true };
}
