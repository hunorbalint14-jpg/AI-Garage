import Link from "next/link";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/staff/page-header";
import { BookingForm } from "./booking-form";

type CustomerRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
};

type VehicleRow = {
  id: string;
  customer_id: string;
  registration: string;
  make: string | null;
  model: string | null;
};

export default async function NewBookingPage({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string; vehicle?: string }>;
}) {
  const params = await searchParams;
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  const [customersRes, vehiclesRes] = await Promise.all([
    admin
      .from("customers")
      .select("id, full_name, email, phone")
      .eq("location_id", ctx.location.id)
      .order("full_name", { ascending: true })
      .limit(1000),
    admin
      .from("vehicles")
      .select("id, customer_id, registration, make, model")
      .eq("location_id", ctx.location.id)
      .order("created_at", { ascending: false })
      .limit(2000),
  ]);

  const customers = (customersRes.data ?? []) as CustomerRow[];
  const vehicles = (vehiclesRes.data ?? []) as VehicleRow[];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/staff/bookings" className="text-sm text-muted-foreground underline">
          ← Back to bookings
        </Link>
      </div>
      <PageHeader title="New booking" description="Schedule an appointment for a customer." />
      <BookingForm
        customers={customers}
        vehicles={vehicles}
        defaultCustomerId={params.customer ?? null}
        defaultVehicleId={params.vehicle ?? null}
      />
    </div>
  );
}
