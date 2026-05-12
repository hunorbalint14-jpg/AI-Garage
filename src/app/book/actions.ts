"use server";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { sendSms } from "@/lib/sms";
import { normalizeRegistration, validateRegistration } from "@/lib/registration";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type WidgetBookingResult = { error: string } | { success: true };

export async function submitWidgetBooking(
  formData: FormData,
): Promise<WidgetBookingResult> {
  const headersList = await headers();
  const slug = headersList.get("x-tenant-slug");
  if (!slug) return { error: "Garage not found." };

  const admin = createAdminClient();

  const { data: location } = await admin
    .from("locations")
    .select("id, name, organization:organizations(id, name, phone, primary_color)")
    .eq("slug", slug)
    .maybeSingle() as {
    data: { id: string; name: string; organization: { id: string; name: string; phone: string | null; primary_color: string } | null } | null;
  };

  if (!location?.organization) return { error: "Garage not found." };

  const fullName = (formData.get("fullName") as string | null)?.trim();
  const email = (formData.get("email") as string | null)?.trim().toLowerCase();
  const phone = (formData.get("phone") as string | null)?.trim() || null;
  const regInput = (formData.get("registration") as string | null)?.trim() || null;
  const type = (formData.get("type") as string | null)?.trim() || "service";
  const scheduledAt = (formData.get("scheduledAt") as string | null)?.trim();
  const notes = (formData.get("notes") as string | null)?.trim() || null;
  const marketingConsent = formData.get("marketingConsent") === "on";

  if (!fullName) return { error: "Name is required." };
  if (!email || !EMAIL_RE.test(email)) return { error: "A valid email is required." };
  if (!scheduledAt) return { error: "Preferred date and time is required." };

  // Validate registration if provided
  let registration: string | null = null;
  if (regInput) {
    const regError = validateRegistration(regInput);
    if (regError) return { error: regError };
    registration = normalizeRegistration(regInput);
  }

  // Find or create customer
  const { data: existingCustomer } = await admin
    .from("customers")
    .select("id, full_name, email, phone")
    .eq("location_id", location.id)
    .eq("email", email)
    .maybeSingle();

  let customerId: string;

  if (existingCustomer) {
    customerId = existingCustomer.id;
    // Update phone if not set
    if (!existingCustomer.phone && phone) {
      await admin.from("customers").update({ phone }).eq("id", customerId);
    }
  } else {
    const { data: newCustomer, error: custErr } = await admin
      .from("customers")
      .insert({
        location_id: location.id,
        full_name: fullName,
        email,
        phone,
        marketing_email_consent: marketingConsent,
        marketing_sms_consent: marketingConsent,
        consent_updated_at: marketingConsent ? new Date().toISOString() : null,
      })
      .select("id")
      .single();
    if (custErr) return { error: "Failed to create customer record." };
    customerId = newCustomer.id;
  }

  // Find or create vehicle
  let vehicleId: string | null = null;
  if (registration) {
    const { data: existingVehicle } = await admin
      .from("vehicles")
      .select("id")
      .eq("location_id", location.id)
      .eq("registration", registration)
      .maybeSingle();

    if (existingVehicle) {
      vehicleId = existingVehicle.id;
    } else {
      const { data: newVehicle } = await admin
        .from("vehicles")
        .insert({ location_id: location.id, customer_id: customerId, registration })
        .select("id")
        .single();
      if (newVehicle) vehicleId = newVehicle.id;
    }
  }

  // Create booking
  const { error: bookingErr } = await admin.from("bookings").insert({
    location_id: location.id,
    customer_id: customerId,
    vehicle_id: vehicleId,
    scheduled_at: new Date(scheduledAt).toISOString(),
    duration_minutes: 60,
    type,
    notes,
    status: "scheduled",
  });

  if (bookingErr) return { error: bookingErr.message };

  const garageName = location.organization.name;
  const garagePhone = location.organization.phone;
  const typeLabel = type === "mot" ? "MOT" : type.charAt(0).toUpperCase() + type.slice(1);
  const dateStr = new Date(scheduledAt).toLocaleString("en-GB", {
    weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
  });
  const firstName = fullName.split(" ")[0];

  // Confirmation to customer
  const confirmText = `Hi ${firstName},\n\nYour ${typeLabel} appointment${registration ? ` for ${registration}` : ""} at ${garageName} is confirmed for ${dateStr}.${garagePhone ? `\n\nTo reschedule or cancel, call us on ${garagePhone} or reply to this email.` : "\n\nTo reschedule or cancel, reply to this email."}\n\nSee you then!\n${garageName}`;

  await sendEmail({
    to: email,
    subject: `Booking confirmed — ${typeLabel} at ${garageName}`,
    text: confirmText,
  });
  if (phone) {
    await sendSms({ to: phone, body: `Hi ${firstName}, your ${typeLabel} at ${garageName} on ${dateStr} is confirmed.${garagePhone ? ` Call ${garagePhone} to reschedule.` : ""}` });
  }

  // Notify staff (org owners/admins)
  const { data: orgUsers } = await admin
    .from("org_users")
    .select("user_id")
    .eq("organization_id", location.organization.id);

  for (const { user_id } of orgUsers ?? []) {
    const { data } = await admin.auth.admin.getUserById(user_id);
    if (data.user?.email) {
      await sendEmail({
        to: data.user.email,
        subject: `New booking — ${typeLabel} from ${fullName}`,
        text: `New booking via the widget:\n\nCustomer: ${fullName} (${email}${phone ? `, ${phone}` : ""})\nType: ${typeLabel}\nPreferred: ${dateStr}${registration ? `\nVehicle: ${registration}` : ""}${notes ? `\nNotes: ${notes}` : ""}\n\nLog in to view the booking in the staff portal.`,
      });
    }
  }

  return { success: true };
}
