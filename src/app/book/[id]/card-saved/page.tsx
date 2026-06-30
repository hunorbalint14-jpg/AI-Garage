import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = {
  title: "Booking confirmed · AI Garage",
};

// Landing page after the no-show card-save step (both success and skip —
// the booking is confirmed either way; the card is just the safety net).
export default async function CardSavedPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ skipped?: string }>;
}) {
  const { id } = await params;
  const { skipped } = await searchParams;

  const admin = createAdminClient();
  const { data } = await admin
    .from("bookings")
    .select("id, scheduled_at, location:locations(name, organization:organizations!organization_id(name))")
    .eq("id", id)
    .maybeSingle();

  type Row = {
    id: string;
    scheduled_at: string;
    location: { name: string; organization: { name: string } | null } | null;
  };
  const booking = data as unknown as Row | null;
  const garageName =
    booking?.location?.organization?.name ?? booking?.location?.name ?? "the garage";
  const when = booking
    ? new Date(booking.scheduled_at).toLocaleString("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <main className="min-h-screen w-full grid place-items-center bg-slate-50 px-4">
      <div className="max-w-md w-full rounded-lg border bg-white p-8 text-center">
        <h1 className="text-2xl font-bold mb-2">Booking confirmed</h1>
        {when && (
          <p className="text-sm text-slate-600 mb-3">
            See you at {garageName} on {when}.
          </p>
        )}
        {skipped ? (
          <p className="text-xs text-slate-500">
            No card was saved — that&apos;s fine, your appointment still stands. A confirmation has
            been sent to your email.
          </p>
        ) : (
          <p className="text-xs text-slate-500">
            Your card has been saved securely with Stripe. Nothing is charged unless you miss the
            appointment without letting the garage know. A confirmation has been sent to your email.
          </p>
        )}
      </div>
    </main>
  );
}
