import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { tenantOrigin } from "@/lib/stripe";

export const metadata: Metadata = {
  title: "Booking confirmed · AI Garage",
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

export default async function BookingPaidPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const admin = createAdminClient();
  const { data: booking } = await admin
    .from("bookings")
    .select("id, scheduled_at, paid_amount_pence, service:services(name), location:locations(name, slug, organization:organizations(name))")
    .eq("id", id)
    .maybeSingle();

  type BookingRow = {
    id: string;
    scheduled_at: string;
    paid_amount_pence: number | null;
    service: { name: string } | null;
    location: { name: string; slug: string; organization: { name: string } | null } | null;
  };
  const b = booking as unknown as BookingRow | null;

  const serviceName = b?.service?.name ?? "appointment";
  const garageName = b?.location?.organization?.name ?? "the garage";
  const when = b?.scheduled_at
    ? new Date(b.scheduled_at).toLocaleString("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;
  const amount = b?.paid_amount_pence
    ? new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(
        b.paid_amount_pence / 100,
      )
    : null;

  // Booking always lives on a tenant subdomain. Build the link to that
  // tenant's dashboard so the user lands back in their portal (with the
  // right auth cookies), not on the apex /dashboard where they'd be
  // bounced to /login because there's no tenant context.
  const dashboardUrl = b?.location?.slug
    ? `${tenantOrigin(b.location.slug)}/dashboard`
    : "/dashboard";

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0b0d11] text-white px-6">
      <div className="max-w-md w-full text-center rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm p-10">
        <div className="mx-auto mb-6 inline-flex h-14 w-14 items-center justify-center rounded-full bg-green-500/20 text-green-300 text-3xl">
          ✓
        </div>
        <h1 className="text-2xl font-bold">Booking confirmed</h1>
        <p className="mt-3 text-sm text-gray-300">
          Your <span className="font-semibold">{serviceName}</span> at{" "}
          <span className="font-semibold">{garageName}</span>
          {when ? (
            <>
              {" "}is booked for <span className="font-semibold">{when}</span>.
            </>
          ) : (
            "."
          )}
        </p>
        {amount && (
          <p className="mt-2 text-sm text-gray-400">
            Payment of <span className="font-semibold text-gray-200">{amount}</span> received.
          </p>
        )}
        <p className="mt-6 text-xs text-gray-500">
          A receipt has been emailed to you by Stripe if receipts are enabled on the garage&apos;s account.
        </p>
        <a
          href={dashboardUrl}
          className="mt-6 inline-block text-sm font-semibold text-green-300 underline"
        >
          View my bookings →
        </a>
      </div>
    </div>
  );
}
