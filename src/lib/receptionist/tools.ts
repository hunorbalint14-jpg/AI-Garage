import type Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "@/lib/supabase/admin";
import { bayCapacityAt } from "@/lib/bay-availability";
import { createStaffNotification } from "@/lib/staff-notifications";
import { logAudit } from "@/lib/audit";
import { candidateSlots, freeSlots, formatSlotLabel, type SlotBooking } from "./slots";
import {
  weekdayOfLocalDate,
  weekdayOfInstant,
  isOpenOn,
  formatBusinessDays,
  WEEKDAY_FULL,
} from "@/lib/business-days";

// Tool surface for the receptionist agent. Every tool returns a plain string
// — the model reads it like a colleague's note. Tools never throw; failures
// come back as text the model can apologise around.

export const RECEPTIONIST_TOOLS: Anthropic.Tool[] = [
  {
    name: "list_services",
    description:
      "List the services this garage offers, with prices and durations. Use before quoting a price.",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "check_availability",
    description:
      "Get the free appointment slots for a date (YYYY-MM-DD). Only offer customers times returned by this tool.",
    input_schema: {
      type: "object" as const,
      properties: {
        date: { type: "string", description: "The date to check, YYYY-MM-DD" },
      },
      required: ["date"],
    },
  },
  {
    name: "create_booking",
    description:
      "Book the customer in. Only call after they have confirmed a specific slot returned by check_availability, given their name, and chosen a service.",
    input_schema: {
      type: "object" as const,
      properties: {
        full_name: { type: "string", description: "Customer's full name" },
        service_id: { type: "string", description: "Service id from list_services" },
        scheduled_at: {
          type: "string",
          description: "Confirmed slot start time, ISO 8601 (from check_availability)",
        },
        registration: { type: "string", description: "Vehicle registration, if given" },
      },
      required: ["full_name", "service_id", "scheduled_at"],
    },
  },
  {
    name: "hand_off",
    description:
      "Hand the conversation to a human at the garage. Use when the customer asks for something you can't do (complex diagnostics, complaints, pricing you can't find), asks for a person, or seems frustrated.",
    input_schema: {
      type: "object" as const,
      properties: {
        reason: { type: "string", description: "One line on why you're handing off" },
      },
      required: ["reason"],
    },
  },
];

export type ToolContext = {
  locationId: string;
  organizationId: string;
  conversationId: string;
  customerPhone: string;
  businessHoursStart: number;
  businessHoursEnd: number;
  /** Open weekdays as JS getDay() numbers (0=Sun..6=Sat). */
  businessDays: number[];
};

export type ToolOutcome = {
  result: string;
  bookingId?: string;
  handedOff?: boolean;
};

export async function executeReceptionistTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  try {
    switch (name) {
      case "list_services":
        return { result: await listServices(ctx) };
      case "check_availability":
        return { result: await checkAvailability(String(input.date ?? ""), ctx) };
      case "create_booking":
        return await createBooking(input, ctx);
      case "hand_off":
        return await handOff(String(input.reason ?? "Customer asked for a person"), ctx);
      default:
        return { result: `Unknown tool: ${name}` };
    }
  } catch (err) {
    console.error("[receptionist] tool failed", { name, err });
    return { result: "That didn't work just now — apologise and offer to have the garage call back." };
  }
}

async function listServices(ctx: ToolContext): Promise<string> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("services")
    .select("id, name, category, price, duration_minutes")
    .eq("location_id", ctx.locationId)
    .eq("active", true)
    .order("name");
  type Row = { id: string; name: string; category: string; price: number | null; duration_minutes: number | null };
  const rows = (data ?? []) as Row[];
  if (rows.length === 0) return "No services are listed — hand off to the garage for pricing.";
  return rows
    .map(
      (s) =>
        `${s.name} (id: ${s.id}) — ${s.price != null ? `£${Number(s.price).toFixed(2)}` : "price on request"}, ~${s.duration_minutes ?? 60} min`,
    )
    .join("\n");
}

async function checkAvailability(date: string, ctx: ToolContext): Promise<string> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "Invalid date — use YYYY-MM-DD.";
  const weekday = weekdayOfLocalDate(date);
  if (!isOpenOn(ctx.businessDays, weekday)) {
    return `Closed on ${WEEKDAY_FULL[weekday]}s — we're open ${formatBusinessDays(ctx.businessDays)}. Offer one of those days.`;
  }
  const candidates = candidateSlots(date, ctx.businessHoursStart, ctx.businessHoursEnd);
  if (candidates.length === 0) return `No bookable times left on ${date}.`;

  const admin = createAdminClient();
  const dayStart = new Date(`${date}T00:00:00`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const [{ count: bayCount }, { data: bookings }] = await Promise.all([
    admin.from("bays").select("id", { count: "exact", head: true }).eq("location_id", ctx.locationId),
    admin
      .from("bookings")
      .select("scheduled_at, duration_minutes, bay_id")
      .eq("location_id", ctx.locationId)
      .in("status", ["scheduled", "in_progress", "payment_pending"])
      .gte("scheduled_at", new Date(dayStart.getTime() - 8 * 60 * 60 * 1000).toISOString())
      .lt("scheduled_at", dayEnd.toISOString()),
  ]);

  const free = freeSlots(candidates, (bookings ?? []) as SlotBooking[], bayCount ?? 0);
  if (free.length === 0) return `Fully booked on ${date} — try another day.`;
  return free.map((s) => `${formatSlotLabel(s)} (iso: ${s.toISOString()})`).join("\n");
}

async function createBooking(
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  const fullName = String(input.full_name ?? "").trim();
  const serviceId = String(input.service_id ?? "").trim();
  const scheduledAt = String(input.scheduled_at ?? "").trim();
  const registration = String(input.registration ?? "").trim().replace(/\s+/g, "").toUpperCase() || null;
  if (!fullName || !serviceId || !scheduledAt || isNaN(new Date(scheduledAt).getTime())) {
    return { result: "Missing or invalid booking details — confirm name, service, and slot first." };
  }

  const weekday = weekdayOfInstant(scheduledAt);
  if (!isOpenOn(ctx.businessDays, weekday)) {
    return { result: `We're closed on ${WEEKDAY_FULL[weekday]}s (open ${formatBusinessDays(ctx.businessDays)}). Offer a day we're open.` };
  }

  const admin = createAdminClient();
  const { data: service } = await admin
    .from("services")
    .select("id, name, category, duration_minutes")
    .eq("id", serviceId)
    .eq("location_id", ctx.locationId)
    .maybeSingle();
  if (!service) return { result: "That service id doesn't exist — call list_services again." };

  const duration = (service as { duration_minutes: number | null }).duration_minutes ?? 60;
  const capacity = await bayCapacityAt({
    locationId: ctx.locationId,
    scheduledAt: new Date(scheduledAt).toISOString(),
    durationMinutes: duration,
  });
  if (!capacity.available) {
    return { result: "That slot just filled up — call check_availability again and offer alternatives." };
  }

  // Find-or-create the customer by phone (the one identity we trust here).
  const { data: existing } = await admin
    .from("customers")
    .select("id")
    .eq("organization_id", ctx.organizationId)
    .eq("phone", ctx.customerPhone)
    .maybeSingle();
  let customerId = (existing as { id: string } | null)?.id ?? null;
  if (!customerId) {
    const { data: created, error } = await admin
      .from("customers")
      .insert({ organization_id: ctx.organizationId, preferred_location_id: ctx.locationId, full_name: fullName, phone: ctx.customerPhone })
      .select("id")
      .single();
    if (error || !created) return { result: "Couldn't save the customer record — hand off to the garage." };
    customerId = (created as { id: string }).id;
  }

  let vehicleId: string | null = null;
  if (registration) {
    const { data: vehicle } = await admin
      .from("vehicles")
      .upsert(
        { location_id: ctx.locationId, customer_id: customerId, registration },
        { onConflict: "location_id,registration", ignoreDuplicates: false },
      )
      .select("id")
      .maybeSingle();
    vehicleId = (vehicle as { id: string } | null)?.id ?? null;
  }

  const { data: booking, error: bookingError } = await admin
    .from("bookings")
    .insert({
      location_id: ctx.locationId,
      customer_id: customerId,
      vehicle_id: vehicleId,
      scheduled_at: new Date(scheduledAt).toISOString(),
      duration_minutes: duration,
      type: (service as { category: string }).category || "service",
      status: "scheduled",
      notes: "Booked by AI receptionist",
    })
    .select("id")
    .single();
  if (bookingError || !booking) {
    return { result: "Booking insert failed — apologise and hand off to the garage." };
  }
  const bookingId = (booking as { id: string }).id;

  await admin
    .from("receptionist_conversations")
    .update({ customer_id: customerId, booking_id: bookingId, status: "completed" })
    .eq("id", ctx.conversationId);

  await logAudit({
    organizationId: ctx.organizationId,
    action: "receptionist.booking_created",
    entityType: "booking",
    entityId: bookingId,
    metadata: { conversation_id: ctx.conversationId, service: (service as { name: string }).name, scheduled_at: scheduledAt },
  });

  await createStaffNotification({
    userId: null,
    locationId: ctx.locationId,
    organizationId: ctx.organizationId,
    kind: "receptionist.booking",
    title: "AI receptionist booked an appointment",
    body: `${fullName} · ${(service as { name: string }).name} · ${formatSlotLabel(new Date(scheduledAt))}`,
    href: `/staff/bookings/${bookingId}`,
    entityType: "booking",
    entityId: bookingId,
  });

  return {
    result: `Booked: ${(service as { name: string }).name} on ${formatSlotLabel(new Date(scheduledAt))} for ${fullName}. Confirm this to the customer.`,
    bookingId,
  };
}

async function handOff(reason: string, ctx: ToolContext): Promise<ToolOutcome> {
  const admin = createAdminClient();
  await admin
    .from("receptionist_conversations")
    .update({ status: "handed_off" })
    .eq("id", ctx.conversationId);

  await logAudit({
    organizationId: ctx.organizationId,
    action: "receptionist.handed_off",
    entityType: "receptionist_conversation",
    entityId: ctx.conversationId,
    metadata: { reason, customer_phone: ctx.customerPhone },
  });

  await createStaffNotification({
    userId: null,
    locationId: ctx.locationId,
    organizationId: ctx.organizationId,
    kind: "receptionist.handoff",
    title: "AI receptionist needs a human",
    body: `${ctx.customerPhone} — ${reason}`,
    href: "/staff/receptionist",
    entityType: "receptionist_conversation",
    entityId: ctx.conversationId,
  });

  return {
    result:
      "Handed off — tell the customer someone from the garage will get back to them shortly during opening hours.",
    handedOff: true,
  };
}
