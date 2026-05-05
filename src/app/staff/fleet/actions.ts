"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";

export type FleetResult = { error: string } | { success: true };

export async function createFleetCompany(formData: FormData): Promise<{ error: string } | { id: string }> {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  const name = (formData.get("name") as string | null)?.trim();
  if (!name) return { error: "Company name is required." };

  const { data, error } = await admin.from("fleet_companies").insert({
    location_id: ctx.location.id,
    name,
    contact_name: (formData.get("contactName") as string | null)?.trim() || null,
    contact_email: (formData.get("contactEmail") as string | null)?.trim().toLowerCase() || null,
    contact_phone: (formData.get("contactPhone") as string | null)?.trim() || null,
    notes: (formData.get("notes") as string | null)?.trim() || null,
  }).select("id").single();

  if (error) return { error: error.message };

  revalidatePath("/staff/fleet");
  return { id: data.id };
}

export async function updateFleetCompany(companyId: string, formData: FormData): Promise<FleetResult> {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  const name = (formData.get("name") as string | null)?.trim();
  if (!name) return { error: "Company name is required." };

  const { error } = await admin.from("fleet_companies").update({
    name,
    contact_name: (formData.get("contactName") as string | null)?.trim() || null,
    contact_email: (formData.get("contactEmail") as string | null)?.trim().toLowerCase() || null,
    contact_phone: (formData.get("contactPhone") as string | null)?.trim() || null,
    notes: (formData.get("notes") as string | null)?.trim() || null,
  }).eq("id", companyId).eq("location_id", ctx.location.id);

  if (error) return { error: error.message };

  revalidatePath(`/staff/fleet/${companyId}`);
  revalidatePath("/staff/fleet");
  return { success: true };
}

export async function deleteFleetCompany(companyId: string): Promise<FleetResult> {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  // Unlink customers first
  await admin.from("customers").update({ fleet_company_id: null })
    .eq("fleet_company_id", companyId).eq("location_id", ctx.location.id);

  const { error } = await admin.from("fleet_companies").delete()
    .eq("id", companyId).eq("location_id", ctx.location.id);

  if (error) return { error: error.message };

  revalidatePath("/staff/fleet");
  redirect("/staff/fleet");
}

export async function assignCustomerToFleet(
  customerId: string,
  fleetCompanyId: string | null,
): Promise<FleetResult> {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  const { error } = await admin.from("customers")
    .update({ fleet_company_id: fleetCompanyId })
    .eq("id", customerId)
    .eq("location_id", ctx.location.id);

  if (error) return { error: error.message };

  revalidatePath("/staff/fleet");
  revalidatePath("/staff/customers");
  return { success: true };
}
