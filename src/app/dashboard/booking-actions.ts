"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { sendSms } from "@/lib/sms";

async function getCustomerAndBooking(bookingId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." as string, customer: null, booking: null, org: null };

  const headersList = await headers();
  const slug = headersList.get("x-tenant-slug");
  if (!slug) return { error: "Garage not found.", customer: null, booking: null, org: null };

  const admin = createAdminClient();

  const [locationRes, bookingRes] = await Promise.all([
    admin
      .from("locations")
      .select("id, name, organization:organizations(id, name, phone)")
      .eq("slug", slug)
      .maybeSingle(),
    admin
      .from("bookings")
      .select("id, customer_id, scheduled_at, type, status, location_id")
      .eq("id", bookingId)
      .maybeSingle(),
  ]);

  const location = locationRes.data as { id: string; name: string; organization: { id: string; name: string; phone: string | null } | null } | null;
  const booking = bookingRes.data as { id: string; customer_id: string | null; scheduled_at: string; type: string; status: string; location_id: string } | null;

  if (!location || !booking || !location.organization) return { error: "Not found.", customer: null, booking: null, org: null };
  if (booking.location_id !== location.id) return { error: "Not found.", customer: null, booking: null, org: null };

  // Verify customer owns this booking (customers are org-scoped, not per-branch)
  const { data: customer } = await admin
    .from("customers")
    .select("id, full_name, email, phone")
    .eq("organization_id", location.organization.id)
    .eq("email", user.email ?? "")
    .maybeSingle();

  if (!customer || booking.customer_id !== customer.id) {
    return { error: "Not authorised.", customer: null, booking: null, org: null };
  }

  return { error: null, customer, booking, org: location.organization };
}

export type BookingActionResult = { error: string } | { success: true };

export async function cancelCustomerBooking(bookingId: string): Promise<BookingActionResult> {
  const { error, customer, booking, org } = await getCustomerAndBooking(bookingId);
  if (error) return { error };

  if (booking!.status === "cancelled") return { error: "Already cancelled." };
  if (booking!.status === "complete") return { error: "Cannot cancel a completed appointment." };

  const admin = createAdminClient();
  await admin.from("bookings").update({ status: "cancelled" }).eq("id", bookingId);

  const garageName = org?.name ?? "";
  const firstName = customer!.full_name?.split(" ")[0] ?? "there";
  const typeLabel = booking!.type === "mot" ? "MOT" : booking!.type.charAt(0).toUpperCase() + booking!.type.slice(1);
  const dateStr = new Date(booking!.scheduled_at).toLocaleString("en-GB", {
    weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
  });

  if (customer!.email) {
    await sendEmail({
      to: customer!.email,
      subject: `Appointment cancelled — ${typeLabel} at ${garageName}`,
      text: `Hi ${firstName},\n\nYour ${typeLabel} appointment on ${dateStr} at ${garageName} has been cancelled.\n\nIf you'd like to rebook, please contact us.${org?.phone ? `\n\nCall us on ${org.phone}.` : ""}\n\nThank you,\n${garageName}`,
    });
  }
  if (customer!.phone) {
    await sendSms({ to: customer!.phone, body: `Hi ${firstName}, your ${typeLabel} at ${garageName} on ${dateStr} has been cancelled. Contact us to rebook.` });
  }

  // Notify staff
  const orgUsers = await admin.from("org_users").select("user_id").eq("organization_id", org!.id);
  for (const { user_id } of orgUsers.data ?? []) {
    const { data } = await admin.auth.admin.getUserById(user_id);
    if (data.user?.email) {
      await sendEmail({
        to: data.user.email,
        subject: `Booking cancelled by customer — ${typeLabel} from ${customer!.full_name ?? "customer"}`,
        text: `${customer!.full_name ?? "A customer"} has cancelled their ${typeLabel} appointment on ${dateStr}.\n\nYou can view this in the staff portal.`,
      });
    }
  }

  revalidatePath("/dashboard");
  return { success: true };
}

export async function rescheduleCustomerBooking(
  bookingId: string,
  newDateTime: string,
): Promise<BookingActionResult> {
  const { error, customer, booking, org } = await getCustomerAndBooking(bookingId);
  if (error) return { error };

  if (booking!.status === "cancelled") return { error: "Cannot reschedule a cancelled booking." };
  if (booking!.status === "complete") return { error: "Cannot reschedule a completed appointment." };

  const newDate = new Date(newDateTime);
  if (isNaN(newDate.getTime())) return { error: "Invalid date." };

  const admin = createAdminClient();
  await admin
    .from("bookings")
    .update({ scheduled_at: newDate.toISOString() })
    .eq("id", bookingId);

  const garageName = org?.name ?? "";
  const firstName = customer!.full_name?.split(" ")[0] ?? "there";
  const typeLabel = booking!.type === "mot" ? "MOT" : booking!.type.charAt(0).toUpperCase() + booking!.type.slice(1);
  const newDateStr = newDate.toLocaleString("en-GB", {
    weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
  });

  if (customer!.email) {
    await sendEmail({
      to: customer!.email,
      subject: `Appointment rescheduled — ${typeLabel} at ${garageName}`,
      text: `Hi ${firstName},\n\nYour ${typeLabel} appointment at ${garageName} has been rescheduled to ${newDateStr}.\n\nIf you need to make further changes, please contact us.${org?.phone ? `\n\nCall us on ${org.phone}.` : ""}\n\nSee you then!\n${garageName}`,
    });
  }
  if (customer!.phone) {
    await sendSms({ to: customer!.phone, body: `Hi ${firstName}, your ${typeLabel} at ${garageName} has been rescheduled to ${newDateStr}.${org?.phone ? ` Questions? Call ${org.phone}.` : ""}` });
  }

  // Notify staff
  const orgUsers = await admin.from("org_users").select("user_id").eq("organization_id", org!.id);
  for (const { user_id } of orgUsers.data ?? []) {
    const { data } = await admin.auth.admin.getUserById(user_id);
    if (data.user?.email) {
      await sendEmail({
        to: data.user.email,
        subject: `Booking rescheduled by customer — ${typeLabel} from ${customer!.full_name ?? "customer"}`,
        text: `${customer!.full_name ?? "A customer"} has rescheduled their ${typeLabel} to ${newDateStr}.\n\nView the updated booking in the staff portal.`,
      });
    }
  }

  revalidatePath("/dashboard");
  return { success: true };
}
