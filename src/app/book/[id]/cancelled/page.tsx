import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { tenantOrigin } from "@/lib/stripe";

export const metadata: Metadata = {
  title: "Booking payment cancelled · AI Garage",
  icons: {
    icon: [
      { url: "/brand/icon/aigarage-favicon.svg", type: "image/svg+xml" },
      { url: "/brand/icon/png/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/icon/png/favicon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [
      { url: "/brand/icon/png/apple-touch-icon.png", sizes: "180x180" },
    ],
    shortcut: "/favicon.ico",
  },
};

export default async function BookingCancelledPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const admin = createAdminClient();
  const { data: booking } = await admin
    .from("bookings")
    .select("id, location:locations(slug)")
    .eq("id", id)
    .maybeSingle();

  type BookingRow = { id: string; location: { slug: string } | null };
  const b = booking as unknown as BookingRow | null;
  const bookUrl = b?.location?.slug ? `${tenantOrigin(b.location.slug)}/book` : "/book";

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0b0d11] text-white px-6">
      <div className="max-w-md w-full text-center rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm p-10">
        <h1 className="text-2xl font-bold">Payment cancelled</h1>
        <p className="mt-3 text-sm text-gray-400">
          No charge was made and the booking slot was not held. Pick a new time
          and try again to confirm your appointment.
        </p>
        <a
          href={bookUrl}
          className="mt-6 inline-block rounded-lg bg-green-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-green-500 transition-colors"
        >
          Back to booking
        </a>
      </div>
    </div>
  );
}
