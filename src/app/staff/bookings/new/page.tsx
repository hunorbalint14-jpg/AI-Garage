import Link from "next/link";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/staff/page-header";
import { getPickerCustomer } from "@/app/staff/customer-picker-actions";
import { BookingForm } from "./booking-form";

export default async function NewBookingPage({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string; vehicle?: string }>;
}) {
  const params = await searchParams;
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  // Customers/vehicles come from the typeahead picker on demand — only a
  // ?customer= deep link needs resolving up front.
  const [servicesRes, baysRes, initialCustomer] = await Promise.all([
    admin
      .from("services")
      .select("id, name, category, duration_minutes, price")
      .eq("location_id", ctx.location.id)
      .eq("active", true)
      .order("category", { ascending: true })
      .order("name", { ascending: true }),
    admin
      .from("bays")
      .select("id, name, description")
      .eq("location_id", ctx.location.id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    params.customer ? getPickerCustomer(params.customer) : Promise.resolve(null),
  ]);

  const services = (servicesRes.data ?? []) as { id: string; name: string; category: string; duration_minutes: number; price: number | null }[];
  const bays = (baysRes.data ?? []) as { id: string; name: string; description: string | null }[];

  // All branches in the org, so the form can name a customer's *home* branch
  // when it differs from the active branch they're being booked into.
  const { data: orgLocations } = await admin
    .from("locations")
    .select("id, name")
    .eq("organization_id", ctx.organization.id);
  const locationNamesById: Record<string, string> = Object.fromEntries(
    ((orgLocations ?? []) as { id: string; name: string }[]).map((l) => [l.id, l.name]),
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/staff/bookings" className="text-sm text-muted-foreground underline">
          ← Back to bookings
        </Link>
      </div>
      <PageHeader title="New booking" description="Schedule an appointment for a customer." />
      <BookingForm
        services={services}
        bays={bays}
        initialCustomer={initialCustomer}
        defaultVehicleId={params.vehicle ?? null}
        activeLocationId={ctx.location.id}
        activeLocationName={ctx.location.name}
        locationNamesById={locationNamesById}
      />
    </div>
  );
}
