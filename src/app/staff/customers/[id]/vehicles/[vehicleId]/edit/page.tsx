import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { EditVehicleForm } from "./edit-vehicle-form";

export default async function EditVehiclePage({
  params,
}: {
  params: Promise<{ id: string; vehicleId: string }>;
}) {
  const { id, vehicleId } = await params;
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  const { data: vehicle } = await admin
    .from("vehicles")
    .select("id, registration, make, model, year, mot_expiry, service_due")
    .eq("id", vehicleId)
    .eq("customer_id", id)
    .eq("location_id", ctx.location.id)
    .maybeSingle();

  if (!vehicle) notFound();

  return (
    <div className="flex flex-col gap-4 max-w-lg">
      <div>
        <Link
          href={`/staff/customers/${id}`}
          className="text-sm text-muted-foreground underline"
        >
          ← Back to customer
        </Link>
        <h1 className="text-2xl font-bold">Edit vehicle</h1>
        <p className="text-sm text-muted-foreground font-mono">{vehicle.registration}</p>
      </div>
      <EditVehicleForm vehicle={vehicle} customerId={id} />
    </div>
  );
}
