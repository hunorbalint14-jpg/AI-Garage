import { verifyBookingConfirmAccess } from "@/lib/booking-confirm";
import { createAdminClient } from "@/lib/supabase/admin";
import { ConfirmButtons } from "./confirm-buttons";

export const dynamic = "force-dynamic";

type OrgBrand = { name: string; primary_color: string | null; logo_url: string | null };

function Shell({ accent, children }: { accent: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f5f4f0] flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
        <div className="mb-6 h-1 w-12 rounded-full" style={{ backgroundColor: accent }} />
        {children}
      </div>
    </div>
  );
}

export default async function ConfirmBookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { id } = await params;
  const { t } = await searchParams;
  const verify = await verifyBookingConfirmAccess(id, t ?? null);

  if (!verify.ok) {
    return (
      <Shell accent="#22c55e">
        <h1 className="text-lg font-semibold text-gray-900">Link unavailable</h1>
        <p className="mt-2 text-sm text-gray-600">
          This confirmation link is invalid, or the booking has already taken place or changed.
          If you need to check your appointment, please contact the garage directly.
        </p>
      </Shell>
    );
  }

  const booking = verify.booking;
  const admin = createAdminClient();
  const [{ data: locationData }, { data: vehicleData }] = await Promise.all([
    admin
      .from("locations")
      .select("name, organization:organizations(name, primary_color, logo_url)")
      .eq("id", booking.location_id)
      .maybeSingle(),
    booking.vehicle_id
      ? admin.from("vehicles").select("registration, make, model").eq("id", booking.vehicle_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const location = locationData as { name: string; organization: OrgBrand | null } | null;
  const vehicle = vehicleData as { registration: string; make: string | null; model: string | null } | null;
  const org = location?.organization;
  const garageName = org?.name ?? location?.name ?? "the garage";
  const accent = org?.primary_color ?? "#22c55e";

  const when = new Date(booking.scheduled_at).toLocaleString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <Shell accent={accent}>
      <div className="mb-5 flex items-center gap-3">
        {org?.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={org.logo_url} alt={garageName} className="h-8 w-auto object-contain" />
        ) : (
          <div
            className="flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold text-white"
            style={{ backgroundColor: accent }}
          >
            {garageName.charAt(0)}
          </div>
        )}
        <span className="text-sm font-medium text-gray-700">{garageName}</span>
      </div>

      <h1 className="text-lg font-semibold text-gray-900">Your upcoming booking</h1>
      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-gray-500">When</dt>
          <dd className="text-right font-medium text-gray-900">{when}</dd>
        </div>
        {vehicle && (
          <div className="flex justify-between gap-4">
            <dt className="text-gray-500">Vehicle</dt>
            <dd className="text-right font-medium text-gray-900">
              {vehicle.registration}
              {(vehicle.make || vehicle.model) && (
                <span className="block text-xs font-normal text-gray-500">
                  {[vehicle.make, vehicle.model].filter(Boolean).join(" ")}
                </span>
              )}
            </dd>
          </div>
        )}
        <div className="flex justify-between gap-4">
          <dt className="text-gray-500">Type</dt>
          <dd className="text-right font-medium text-gray-900">
            {booking.type === "mot" ? "MOT" : booking.type.charAt(0).toUpperCase() + booking.type.slice(1)}
          </dd>
        </div>
      </dl>

      <ConfirmButtons
        bookingId={booking.id}
        token={t!}
        accent={accent}
        initialConfirmed={Boolean(booking.confirmed_at)}
        initialRescheduleRequested={Boolean(booking.reschedule_requested_at)}
      />
    </Shell>
  );
}
