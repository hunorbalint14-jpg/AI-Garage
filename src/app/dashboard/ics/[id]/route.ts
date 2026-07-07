import { createAdminClient } from "@/lib/supabase/admin";
import { getPortalContext } from "@/lib/portal-auth";

// "Add to calendar" download for a customer's own booking (UX review §1g).
// Plain-text ICS is all calendar apps need.

function icsStamp(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { customer, location } = await getPortalContext();
  if (!customer) return new Response("Not found", { status: 404 });

  const admin = createAdminClient();
  const { data } = await admin
    .from("bookings")
    .select(
      "id, customer_id, scheduled_at, duration_minutes, type, location:locations(name, address)",
    )
    .eq("id", id)
    .maybeSingle();

  const booking = data as {
    id: string;
    customer_id: string;
    scheduled_at: string;
    duration_minutes: number;
    type: string;
    location: { name: string; address: string | null } | null;
  } | null;
  if (!booking || booking.customer_id !== customer.id) {
    return new Response("Not found", { status: 404 });
  }

  const orgName = location.organization.name;
  const typeLabel = booking.type === "mot" ? "MOT" : booking.type.charAt(0).toUpperCase() + booking.type.slice(1);
  const start = new Date(booking.scheduled_at);
  const end = new Date(start.getTime() + (booking.duration_minutes || 60) * 60_000);
  const where = [booking.location?.name, booking.location?.address].filter(Boolean).join(", ");

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//AI Garage//Booking//EN",
    "BEGIN:VEVENT",
    `UID:booking-${booking.id}@ai-garage`,
    `DTSTAMP:${icsStamp(new Date().toISOString())}`,
    `DTSTART:${icsStamp(start.toISOString())}`,
    `DTEND:${icsStamp(end.toISOString())}`,
    `SUMMARY:${esc(`${typeLabel} — ${orgName}`)}`,
    where ? `LOCATION:${esc(where)}` : null,
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n");

  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${typeLabel.toLowerCase()}-${booking.id.slice(0, 8)}.ics"`,
    },
  });
}
