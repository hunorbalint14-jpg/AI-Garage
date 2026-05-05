"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { sendSms } from "@/lib/sms";

export type BookingRequestResult = { error: string } | { success: true };

export async function requestBooking(formData: FormData): Promise<BookingRequestResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const headersList = await headers();
  const slug = headersList.get("x-tenant-slug");
  if (!slug) return { error: "Garage not found." };

  const admin = createAdminClient();

  const [locationRes] = await Promise.all([
    admin
      .from("locations")
      .select("id, name, organization:organizations(id, name, phone)")
      .eq("slug", slug)
      .maybeSingle(),
  ]);

  const location = locationRes.data as {
    id: string;
    name: string;
    organization: { id: string; name: string; phone: string | null } | null;
  } | null;
  if (!location) return { error: "Location not found." };

  const { data: customer } = await admin
    .from("customers")
    .select("id, full_name, email, phone")
    .eq("location_id", location.id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!customer) {
    // Fallback: match by email
    const { data: byEmail } = await admin
      .from("customers")
      .select("id, full_name, email, phone")
      .eq("location_id", location.id)
      .eq("email", user.email ?? "")
      .maybeSingle();
    if (!byEmail) return { error: "Customer record not found." };
    await admin.from("customers").update({ user_id: user.id }).eq("id", byEmail.id);
    Object.assign(customer ?? {}, byEmail);
  }

  const cust = customer as { id: string; full_name: string | null; email: string | null; phone: string | null };

  const vehicleId = (formData.get("vehicleId") as string | null)?.trim() || null;
  const type = (formData.get("type") as string | null)?.trim() || "service";
  const scheduledAt = (formData.get("scheduledAt") as string | null)?.trim();
  const notes = (formData.get("notes") as string | null)?.trim() || null;

  if (!scheduledAt) return { error: "Preferred date and time is required." };

  const { error } = await admin.from("bookings").insert({
    location_id: location.id,
    customer_id: cust.id,
    vehicle_id: vehicleId || null,
    scheduled_at: new Date(scheduledAt).toISOString(),
    duration_minutes: 60,
    type,
    notes,
    status: "scheduled",
  });

  if (error) return { error: error.message };

  const orgName = location.organization?.name ?? location.name;
  const firstName = cust.full_name?.split(" ")[0] ?? "there";
  const typeLabel = type === "mot" ? "MOT" : type.charAt(0).toUpperCase() + type.slice(1);
  const dateStr = new Date(scheduledAt).toLocaleString("en-GB", {
    weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
  });

  if (cust.email) {
    await sendEmail({
      to: cust.email,
      subject: `Booking request received — ${typeLabel} at ${orgName}`,
      text: `Hi ${firstName},\n\nYour ${typeLabel} appointment request for ${dateStr} has been received by ${orgName}. They will confirm your booking shortly.\n\nThank you,\n${orgName}`,
    });
  }
  if (cust.phone) {
    await sendSms({
      to: cust.phone,
      body: `Hi ${firstName}, your ${typeLabel} request for ${dateStr} at ${orgName} has been received. We'll confirm shortly.`,
    });
  }

  return { success: true };
}
