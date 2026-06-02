// Pure helpers for job time tracking. Kept side-effect-free so they're unit
// tested without a DB.

// Whole minutes between two ISO timestamps, never negative.
export function durationMinutes(startIso: string, endIso: string): number {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.round(ms / 60000);
}

// Estimated labour minutes for a job from its line items. Labour lines carry
// their hours in `quantity`; parts/other lines are ignored. Returns 0 when
// there are no labour lines (caller shows "—").
export function labourEstimateMinutes(items: { type: string; quantity: number }[]): number {
  const hours = items
    .filter((i) => i.type === "labour")
    .reduce((sum, i) => sum + (Number(i.quantity) || 0), 0);
  return Math.round(hours * 60);
}

// "2h 30m" / "45m" / "3h". 0 → "0m".
export function formatMinutes(total: number): string {
  const t = Math.max(0, Math.round(total));
  const h = Math.floor(t / 60);
  const m = t % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}
