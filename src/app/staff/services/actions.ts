"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";

export type ServiceResult = { error: string } | { success: true };

function requireOwner(orgRole: string | null) {
  if (!orgRole) throw new Error("Only org owners and admins can manage services.");
}

export type UpsertServiceResult = { error: string } | { success: true; id: string };

export async function upsertService(
  formData: FormData,
  serviceId?: string,
): Promise<UpsertServiceResult> {
  const ctx = await requireStaffContext();
  try { requireOwner(ctx.orgRole); } catch (e) { return { error: (e as Error).message }; }

  const admin = createAdminClient();

  const name = (formData.get("name") as string | null)?.trim();
  const category = (formData.get("category") as string | null)?.trim() || "general";
  const description = (formData.get("description") as string | null)?.trim() || null;
  const priceStr = (formData.get("price") as string | null)?.trim();
  const durationStr = (formData.get("durationMinutes") as string | null)?.trim();
  const vatIncluded = formData.get("vatIncluded") !== "false";

  if (!name) return { error: "Service name is required." };

  const price = priceStr ? parseFloat(priceStr) : null;
  if (price !== null && (isNaN(price) || price < 0)) return { error: "Invalid price." };

  const duration = durationStr ? parseInt(durationStr, 10) : 60;
  if (isNaN(duration) || duration < 5) return { error: "Invalid duration." };

  const payload = { name, category, description, price, duration_minutes: duration, vat_included: vatIncluded };

  if (serviceId) {
    const { error } = await admin.from("services").update(payload).eq("id", serviceId).eq("location_id", ctx.location.id);
    if (error) return { error: error.message };
    revalidatePath("/staff/services");
    return { success: true, id: serviceId };
  }

  const { data, error } = await admin.from("services").insert({ ...payload, location_id: ctx.location.id }).select("id").single();
  if (error) return { error: error.message };

  revalidatePath("/staff/services");
  return { success: true, id: data.id };
}

export async function toggleServiceActive(serviceId: string, active: boolean): Promise<ServiceResult> {
  const ctx = await requireStaffContext();
  try { requireOwner(ctx.orgRole); } catch (e) { return { error: (e as Error).message }; }

  const admin = createAdminClient();
  const { error } = await admin.from("services").update({ active }).eq("id", serviceId).eq("location_id", ctx.location.id);
  if (error) return { error: error.message };

  revalidatePath("/staff/services");
  return { success: true };
}

export async function deleteService(serviceId: string): Promise<ServiceResult> {
  const ctx = await requireStaffContext();
  try { requireOwner(ctx.orgRole); } catch (e) { return { error: (e as Error).message }; }

  const admin = createAdminClient();
  const { error } = await admin.from("services").delete().eq("id", serviceId).eq("location_id", ctx.location.id);
  if (error) return { error: error.message };

  revalidatePath("/staff/services");
  return { success: true };
}
