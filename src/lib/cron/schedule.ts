export type Frequency = "daily" | "weekly";

export function computeNextRunAt(
  frequency: Frequency,
  hour: number,
  dayOfWeek: number | null,
  from: Date = new Date(),
): Date {
  const next = new Date(from);
  next.setSeconds(0, 0);
  next.setMinutes(0);
  next.setHours(hour);

  if (frequency === "daily") {
    if (next <= from) next.setDate(next.getDate() + 1);
    return next;
  }

  // weekly
  if (dayOfWeek === null) {
    if (next <= from) next.setDate(next.getDate() + 7);
    return next;
  }

  const currentDay = next.getDay();
  let daysToAdd = (dayOfWeek - currentDay + 7) % 7;
  if (daysToAdd === 0 && next <= from) daysToAdd = 7;
  next.setDate(next.getDate() + daysToAdd);
  return next;
}

export function formatSchedule(frequency: Frequency, hour: number, dayOfWeek: number | null): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const hh = `${String(hour).padStart(2, "0")}:00`;
  if (frequency === "daily") return `Daily at ${hh}`;
  return `Weekly on ${days[dayOfWeek ?? 1]} at ${hh}`;
}
