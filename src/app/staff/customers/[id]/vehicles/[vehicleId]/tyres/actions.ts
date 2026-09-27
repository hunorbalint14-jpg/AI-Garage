"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

export type TyreCheckResult = { error: string } | { success: true };

// Comfortably past any real UK odometer, and inside int4 — without the bound
// an oversized entry reached Postgres and came back as a raw driver error.
const MAX_ODOMETER_MILES = 1_500_000;
const ODOMETER_ERROR = "Enter the mileage as a whole number of miles.";

/** null = left blank. "invalid" = typed but not a usable mileage. */
function parseOdometer(raw: FormDataEntryValue | null): number | null | "invalid" {
  const text = String(raw ?? "").trim();
  if (text === "") return null;
  const val = Number(text);
  if (!Number.isInteger(val) || val < 0 || val > MAX_ODOMETER_MILES) return "invalid";
  return val;
}

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

  const odometer = parseOdometer(formData.get("odometer_miles"));
  if (odometer === "invalid") return { error: ODOMETER_ERROR };

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
    odometer_miles: odometer,
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

  // Org-scoped for the same reason as deleteWheelServiceEvent below: the page
  // lists checks from every branch, so a branch-only filter silently matched
  // nothing and still reported success.
  const { data, error } = await admin
    .from("tyre_checks")
    .delete()
    .eq("id", checkId)
    .eq("vehicle_id", vehicleId)
    .eq("organization_id", ctx.organization.id)
    .select("id");

  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "Tyre check not found." };

  revalidatePath(`/staff/customers/${customerId}`);
  return { success: true };
}

// ── Wheel & tyre profile + service events (#596) ─────────────────────────────

async function orgOwnedVehicle(
  admin: ReturnType<typeof createAdminClient>,
  vehicleId: string,
  organizationId: string,
): Promise<boolean> {
  const { data } = await admin
    .from("vehicles")
    .select("id, organization_id")
    .eq("id", vehicleId)
    .maybeSingle();
  return !!data && data.organization_id === organizationId;
}

export async function saveWheelProfile(
  vehicleId: string,
  customerId: string,
  formData: FormData,
): Promise<TyreCheckResult> {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  if (!(await orgOwnedVehicle(admin, vehicleId, ctx.organization.id))) {
    return { error: "Vehicle not found." };
  }

  const tyreConfig = String(formData.get("tyre_config") ?? "unknown");
  if (!["standard", "directional", "staggered", "unknown"].includes(tyreConfig)) {
    return { error: "Pick a tyre configuration." };
  }

  const { error } = await admin.from("vehicle_wheel_profile").upsert(
    {
      vehicle_id: vehicleId,
      organization_id: ctx.organization.id,
      tyre_config: tyreConfig,
      notes: (formData.get("notes") as string | null)?.trim() || null,
      recorded_by: ctx.user.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "vehicle_id" },
  );
  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "vehicle.wheel_profile_update",
    entityType: "vehicle",
    entityId: vehicleId,
    metadata: { tyre_config: tyreConfig },
  });

  revalidatePath(`/staff/customers/${customerId}`);
  return { success: true };
}

export async function addWheelServiceEvent(
  vehicleId: string,
  customerId: string,
  formData: FormData,
): Promise<TyreCheckResult> {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  if (!(await orgOwnedVehicle(admin, vehicleId, ctx.organization.id))) {
    return { error: "Vehicle not found." };
  }

  const serviceType = String(formData.get("service_type") ?? "");
  if (!["rotation", "alignment", "balance"].includes(serviceType)) {
    return { error: "Pick a service type." };
  }

  const odometer = parseOdometer(formData.get("odometer_miles"));
  if (odometer === "invalid") return { error: ODOMETER_ERROR };

  const { error } = await admin.from("wheel_service_events").insert({
    vehicle_id: vehicleId,
    location_id: ctx.location.id,
    service_type: serviceType,
    performed_at:
      (formData.get("performed_at") as string) || new Date().toISOString().split("T")[0],
    odometer_miles: odometer,
    recorded_by: ctx.user.id,
  });
  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "vehicle.wheel_service_recorded",
    entityType: "vehicle",
    entityId: vehicleId,
    metadata: { service_type: serviceType },
  });

  revalidatePath(`/staff/customers/${customerId}`);
  return { success: true };
}

export async function deleteWheelServiceEvent(
  eventId: string,
  vehicleId: string,
  customerId: string,
): Promise<TyreCheckResult> {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  // The vehicle page lists events from every branch on purpose, so scope the
  // delete to the ORG rather than the active branch — a branch-only filter
  // matched nothing for another branch's row and still reported success.
  // Returning the deleted row is what proves it happened: a 0-row delete is
  // not an error to supabase-js, so without this the caller gets a success
  // and the audit log gets an entry for a deletion that never occurred.
  const { data, error } = await admin
    .from("wheel_service_events")
    .delete()
    .eq("id", eventId)
    .eq("vehicle_id", vehicleId)
    .eq("organization_id", ctx.organization.id)
    .select("id, location_id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "Wheel service record not found." };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "vehicle.wheel_service_deleted",
    entityType: "vehicle",
    entityId: vehicleId,
    metadata: { event_id: eventId, location_id: data[0].location_id },
  });

  revalidatePath(`/staff/customers/${customerId}`);
  return { success: true };
}
