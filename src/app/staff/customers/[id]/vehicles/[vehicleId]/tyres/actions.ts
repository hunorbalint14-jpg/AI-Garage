"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";

export type TyreCheckResult = { error: string } | { success: true };

export async function saveTyreCheck(
  vehicleId: string,
  customerId: string,
  formData: FormData,
): Promise<TyreCheckResult> {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  const { data: vehicle } = await admin
    .from("vehicles")
    .select("id, organization_id")
    .eq("id", vehicleId)
    .maybeSingle();

  if (!vehicle || vehicle.organization_id !== ctx.organization.id) {
    return { error: "Vehicle not found." };
  }

  function depth(name: string): number | null {
    const val = parseFloat((formData.get(name) as string | null) ?? "");
    return isNaN(val) ? null : val;
  }

  const { error } = await admin.from("tyre_checks").insert({
    vehicle_id: vehicleId,
    location_id: ctx.location.id,
    checked_at: (formData.get("checkedAt") as string) || new Date().toISOString().split("T")[0],
    nsf_depth: depth("nsf_depth"),
    osf_depth: depth("osf_depth"),
    nsr_depth: depth("nsr_depth"),
    osr_depth: depth("osr_depth"),
    nsf_replaced: formData.get("nsf_replaced") === "on",
    osf_replaced: formData.get("osf_replaced") === "on",
    nsr_replaced: formData.get("nsr_replaced") === "on",
    osr_replaced: formData.get("osr_replaced") === "on",
    notes: (formData.get("notes") as string | null)?.trim() || null,
  });

  if (error) return { error: error.message };

  revalidatePath(`/staff/customers/${customerId}`);
  return { success: true };
}

export async function deleteTyreCheck(
  checkId: string,
  vehicleId: string,
  customerId: string,
): Promise<TyreCheckResult> {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  const { error } = await admin
    .from("tyre_checks")
    .delete()
    .eq("id", checkId)
    .eq("location_id", ctx.location.id);

  if (error) return { error: error.message };

  revalidatePath(`/staff/customers/${customerId}`);
  return { success: true };
}
