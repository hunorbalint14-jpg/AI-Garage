import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { listLocationStaff } from "@/lib/staff-directory";
import { TechnicianSelector } from "@/components/staff/technician-selector";
import { assignBookingTechnician } from "../actions";
import { BookingActions } from "./booking-actions";
import { BaySelector } from "./bay-selector";

type Booking = {
  id: string;
  scheduled_at: string;
  duration_minutes: number;
  type: string;
  status: string;
  notes: string | null;
  created_at: string;
  bay_id: string | null;
  assigned_to: string | null;
  customer: { id: string; full_name: string | null; email: string | null; phone: string | null } | null;
  vehicle: { id: string; registration: string; make: string | null; model: string | null; year: number | null } | null;
  location_id: string;
  card_on_file_at: string | null;
  no_show_charged_at: string | null;
  no_show_charge_amount_pence: number | null;
  no_show_charge_error: string | null;
};

type LinkedJob = { id: string; status: string; completed_at: string | null };

const STATUS_STYLE: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-700",
  in_progress: "bg-amber-100 text-amber-700",
  complete: "bg-green-100 text-green-700",
  cancelled: "bg-gray-100 text-gray-600",
  no_show: "bg-red-100 text-red-700",
};

function statusLabel(s: string) {
  if (s === "in_progress") return "In progress";
  if (s === "no_show") return "No show";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function typeLabel(t: string) {
  if (t === "mot") return "MOT";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export default async function BookingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  const [bookingRes, jobRes, baysRes, staff] = await Promise.all([
    admin
      .from("bookings")
      .select(
        "id, scheduled_at, duration_minutes, type, status, notes, created_at, location_id, bay_id, assigned_to, card_on_file_at, no_show_charged_at, no_show_charge_amount_pence, no_show_charge_error, customer:customers(id, full_name, email, phone), vehicle:vehicles(id, registration, make, model, year)",
      )
      .eq("id", id)
      .maybeSingle(),
    admin
      .from("jobs")
      .select("id, status, completed_at")
      .eq("booking_id", id)
      .maybeSingle(),
    admin
      .from("bays")
      .select("id, name")
      .eq("location_id", ctx.location.id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    listLocationStaff(ctx.location.id, ctx.organization.id),
  ]);

  const { data: orgFeeRow } = await admin
    .from("organizations")
    .select("no_show_fee_pence")
    .eq("id", ctx.organization.id)
    .maybeSingle();
  const noShowFeePence = Number((orgFeeRow as { no_show_fee_pence?: number } | null)?.no_show_fee_pence ?? 0);

  const booking = bookingRes.data as Booking | null;
  if (!booking || booking.location_id !== ctx.location.id) notFound();

  const job = jobRes.data as LinkedJob | null;
  const bays = (baysRes.data ?? []) as { id: string; name: string }[];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/staff/bookings" className="text-sm text-muted-foreground underline">
          ← Back to bookings
        </Link>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">
            {typeLabel(booking.type)} appointment
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {new Date(booking.scheduled_at).toLocaleString("en-GB", {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
            {" — "}
            {booking.duration_minutes} min
          </p>
        </div>
        <span className={`shrink-0 mt-1 inline-block rounded-full px-3 py-1 text-xs font-medium ${STATUS_STYLE[booking.status] ?? ""}`}>
          {statusLabel(booking.status)}
        </span>
      </div>

      <section className="rounded-lg border p-4">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Customer & Vehicle
        </h2>
        <dl className="grid grid-cols-[140px_1fr] gap-y-1 text-sm">
          <dt className="text-muted-foreground">Customer</dt>
          <dd>
            {booking.customer ? (
              <Link href={`/staff/customers/${booking.customer.id}`} className="underline">
                {booking.customer.full_name ?? "Unknown"}
              </Link>
            ) : "—"}
          </dd>
          {booking.customer?.email && (
            <>
              <dt className="text-muted-foreground">Email</dt>
              <dd>{booking.customer.email}</dd>
            </>
          )}
          {booking.customer?.phone && (
            <>
              <dt className="text-muted-foreground">Phone</dt>
              <dd>{booking.customer.phone}</dd>
            </>
          )}
          <dt className="text-muted-foreground">Vehicle</dt>
          <dd>
            {booking.vehicle ? (
              <span>
                <span className="font-mono">{booking.vehicle.registration}</span>
                {booking.vehicle.make || booking.vehicle.model ? (
                  <span className="text-muted-foreground">
                    {" — "}{[booking.vehicle.year, booking.vehicle.make, booking.vehicle.model].filter(Boolean).join(" ")}
                  </span>
                ) : null}
              </span>
            ) : "—"}
          </dd>
        </dl>
      </section>

      {booking.notes && (
        <section className="rounded-lg border p-4">
          <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">Notes</h2>
          <p className="text-sm whitespace-pre-wrap">{booking.notes}</p>
        </section>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <section className="rounded-lg border p-4">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Bay assignment
          </h2>
          <BaySelector bookingId={booking.id} bays={bays} currentBayId={booking.bay_id} />
        </section>

        <section className="rounded-lg border p-4">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Technician
          </h2>
          <TechnicianSelector
            entityId={booking.id}
            staff={staff}
            currentUserId={booking.assigned_to}
            assignAction={assignBookingTechnician}
          />
        </section>
      </div>

      {job && (
        <section className="rounded-lg border p-4 bg-muted/20">
          <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">Linked Job</h2>
          <p className="text-sm">
            Job <span className="capitalize">{job.status}</span>
            {job.completed_at && ` — completed ${new Date(job.completed_at).toLocaleDateString("en-GB")}`}
            {" — "}
            <Link href={`/staff/jobs/${job.id}`} className="underline">Open job card →</Link>
          </p>
        </section>
      )}

      <BookingActions
        bookingId={booking.id}
        status={booking.status}
        hasJob={!!job}
        jobId={job?.id}
        cardOnFile={!!booking.card_on_file_at}
        noShowFeePence={noShowFeePence}
        noShowChargedAt={booking.no_show_charged_at}
        noShowChargeAmountPence={booking.no_show_charge_amount_pence}
        noShowChargeError={booking.no_show_charge_error}
      />
    </div>
  );
}
