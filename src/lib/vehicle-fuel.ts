import type { createAdminClient } from "@/lib/supabase/admin";
import { lookupVehicleVes } from "@/lib/dvla-ves";
import { isHighVoltageFuel } from "@/lib/ev-readiness";

// Resolve whether a vehicle is high-voltage (EV / hybrid) from its DVLA fuel
// type. Uses the cached vehicles.fuel_type when present; otherwise does a
// best-effort VES lookup by registration and caches the result. Always
// best-effort — returns false (and never throws) when the lookup is
// unavailable, so callers can fold it into job creation without risk.
export async function resolveVehicleHighVoltage(
  admin: ReturnType<typeof createAdminClient>,
  vehicleId: string | null,
): Promise<boolean> {
  if (!vehicleId) return false;
  try {
    const { data } = await admin
      .from("vehicles")
      .select("id, registration, fuel_type")
      .eq("id", vehicleId)
      .maybeSingle();
    const vehicle = data as { id: string; registration: string | null; fuel_type: string | null } | null;
    if (!vehicle) return false;

    if (vehicle.fuel_type) return isHighVoltageFuel(vehicle.fuel_type);
    if (!vehicle.registration) return false;

    const ves = await lookupVehicleVes(vehicle.registration);
    if (!ves.success || !ves.fuelType) return false;

    // Cache it so the next job on this vehicle skips the API call.
    await admin.from("vehicles").update({ fuel_type: ves.fuelType }).eq("id", vehicle.id);
    return isHighVoltageFuel(ves.fuelType);
  } catch (err) {
    console.error("[vehicle-fuel] HV resolve failed", { vehicleId, err });
    return false;
  }
}
