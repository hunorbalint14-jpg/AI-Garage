import { createAdminClient } from "@/lib/supabase/admin";
import {
  parseWeeklyHours,
  checkDateTimeWithinHours,
  formatWeeklySummary,
  formatDayHours,
  type SpecialHours,
  type WeeklyHours,
  type HoursCheck,
} from "@/lib/business-hours";

type Admin = ReturnType<typeof createAdminClient>;

export type LocationHoursCheck = HoursCheck & {
  weekly: WeeklyHours;
  // Ready-made customer-facing sentence for the non-open statuses; null when open.
  message: string | null;
};

// Load a branch's weekly hours + any special/holiday override for the target
// date, then check the requested naive local datetime ("YYYY-MM-DDTHH:mm")
// against them. Booking/reschedule server actions share this so every path
// answers "are we open then?" identically (resolveHoursForDate underneath).
export async function checkLocationHoursAt(
  admin: Admin,
  locationId: string,
  locationName: string,
  dateTimeStr: string,
): Promise<LocationHoursCheck> {
  const dateKey = dateTimeStr.slice(0, 10);
  const [{ data: locRow }, { data: specialRow }] = await Promise.all([
    admin.from("locations").select("business_hours").eq("id", locationId).maybeSingle(),
    admin
      .from("location_special_hours")
      .select("date, is_closed, open_minute, close_minute")
      .eq("location_id", locationId)
      .eq("date", dateKey)
      .maybeSingle(),
  ]);

  const weekly = parseWeeklyHours((locRow as { business_hours: unknown } | null)?.business_hours);
  const exceptions: SpecialHours[] = specialRow
    ? [
        {
          date: (specialRow as { date: string }).date,
          isClosed: (specialRow as { is_closed: boolean }).is_closed,
          openMinute: (specialRow as { open_minute: number | null }).open_minute,
          closeMinute: (specialRow as { close_minute: number | null }).close_minute,
        },
      ]
    : [];

  const check = checkDateTimeWithinHours(weekly, exceptions, dateTimeStr);
  const message =
    check.status === "closed_day"
      ? `${locationName} is closed then. Our hours: ${formatWeeklySummary(weekly)} — please pick another time.`
      : check.status === "outside_hours"
        ? `${locationName} is closed at that time — open ${formatDayHours(check.hours!)} that day. Please pick another time.`
        : null;

  return { ...check, weekly, message };
}
