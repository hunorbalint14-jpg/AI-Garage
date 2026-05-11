import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { ReminderComposer, type QueueVehicle, type SentReminder } from "./reminder-composer";

function dueDays(d: string): number {
  return Math.ceil((new Date(d).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

export default async function RemindersPage() {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  const in60 = new Date();
  in60.setDate(in60.getDate() + 60);

  const [vehiclesRes, remindersRes] = await Promise.all([
    admin
      .from("vehicles")
      .select(
        "id, registration, make, model, year, mot_expiry, service_due, customer:customers(id, full_name, email, phone)",
      )
      .eq("location_id", ctx.location.id)
      .or(
        `mot_expiry.lte.${in60.toISOString().split("T")[0]},service_due.lte.${in60.toISOString().split("T")[0]}`,
      )
      .order("mot_expiry", { ascending: true })
      .limit(40),
    admin
      .from("reminders")
      .select(
        "id, type, channel, subject, status, sent_at, message_text, customer:customers(id, full_name), vehicle:vehicles(id, registration)",
      )
      .eq("location_id", ctx.location.id)
      .order("sent_at", { ascending: false })
      .limit(300),
  ]);

  type VehicleRow = {
    id: string;
    registration: string;
    make: string | null;
    model: string | null;
    year: number | null;
    mot_expiry: string | null;
    service_due: string | null;
    customer: { id: string; full_name: string | null; email: string | null; phone: string | null } | null;
  };

  type ReminderRow = {
    id: string;
    type: string;
    channel: string;
    subject: string;
    status: string;
    sent_at: string;
    message_text: string | null;
    customer: { id: string; full_name: string | null } | null;
    vehicle: { id: string; registration: string } | null;
  };

  const rawVehicles = (vehiclesRes.data ?? []) as unknown as VehicleRow[];
  const rawReminders = (remindersRes.data ?? []) as unknown as ReminderRow[];

  // Last reminder per vehicle
  const lastReminderByVehicle = new Map<string, string>();
  for (const r of rawReminders) {
    if (!r.vehicle?.id) continue;
    if (!lastReminderByVehicle.has(r.vehicle.id)) {
      lastReminderByVehicle.set(r.vehicle.id, r.sent_at);
    }
  }

  const queue: QueueVehicle[] = rawVehicles
    .filter((v) => v.customer)
    .map((v) => {
      const motDays = v.mot_expiry ? dueDays(v.mot_expiry) : null;
      const svcDays = v.service_due ? dueDays(v.service_due) : null;
      let primaryReminderType: "mot" | "service" = "mot";
      if (motDays === null && svcDays !== null) primaryReminderType = "service";
      else if (svcDays !== null && motDays !== null && svcDays < motDays)
        primaryReminderType = "service";
      return {
        vehicleId: v.id,
        customerId: v.customer!.id,
        customerName: v.customer!.full_name,
        customerEmail: v.customer!.email,
        customerPhone: v.customer!.phone,
        registration: v.registration,
        make: v.make,
        model: v.model,
        year: v.year,
        motExpiry: v.mot_expiry,
        serviceDue: v.service_due,
        motDays,
        svcDays,
        primaryReminderType,
        lastReminderAt: lastReminderByVehicle.get(v.id) ?? null,
      };
    });

  // Group reminders into sent history
  const groupMap = new Map<string, SentReminder>();
  for (const r of rawReminders) {
    const hourKey = r.sent_at ? r.sent_at.slice(0, 13) : "unknown";
    const key = `${r.customer?.id ?? "none"}|${r.subject}|${hourKey}`;
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        key,
        subject: r.subject,
        type: r.type,
        sentAt: r.sent_at,
        customerName: r.customer?.full_name ?? null,
        customerId: r.customer?.id ?? null,
        registration: r.vehicle?.registration ?? null,
        email: null,
        sms: null,
        whatsapp: null,
        emailText: null,
        smsText: null,
        whatsappText: null,
      });
    }
    const group = groupMap.get(key)!;
    const result = r.status === "sent" ? ("sent" as const) : ("failed" as const);
    if (r.channel === "email") { group.email = result; group.emailText = r.message_text ?? null; }
    else if (r.channel === "sms") { group.sms = result; group.smsText = r.message_text ?? null; }
    else if (r.channel === "whatsapp") { group.whatsapp = result; group.whatsappText = r.message_text ?? null; }
  }
  const history = [...groupMap.values()].slice(0, 60);

  const { data: orgData } = await admin
    .from("organizations")
    .select("primary_color")
    .eq("id", ctx.organization.id)
    .single();

  const brandColor = (orgData as { primary_color?: string } | null)?.primary_color ?? "#6366f1";

  return <ReminderComposer queue={queue} history={history} brandColor={brandColor} />;
}
