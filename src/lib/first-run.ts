// First-run policy after a branch goes live (#587).
//
// Prelive (#585) holds everything and #586 shows the owner what's waiting. This
// module governs the *release*: how much of the backlog is allowed out on day
// one, and whether debt that predates go-live is chased at all.
//
// Pure (no server imports) so the Go-live screen can explain the same rules the
// crons enforce, from the same code.

/** How long after go-live the cap applies. One daily reminder run falls inside it. */
export const FIRST_RUN_WINDOW_HOURS = 24;

export const DEFAULT_FIRST_RUN_CAP = 25;

export type FirstRunPolicy = {
  live_at: string | null;
  first_run_cap: number | null;
  chase_prelive_debt: boolean | null;
};

/** True during the branch's first 24 hours live — when the cap binds. */
export function inFirstRunWindow(liveAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!liveAt) return false;
  const live = new Date(liveAt).getTime();
  if (Number.isNaN(live)) return false;
  const age = now.getTime() - live;
  // A clock-skewed future live_at counts as in-window: capping too much is
  // recoverable (it rolls to the next run), sending too much is not.
  return age < FIRST_RUN_WINDOW_HOURS * 60 * 60 * 1000;
}

/**
 * Messages this run may send for the branch, or null for unlimited.
 * Outside the first-run window the cap does not apply at all.
 */
export function firstRunCap(location: FirstRunPolicy, now: Date = new Date()): number | null {
  if (!inFirstRunWindow(location.live_at, now)) return null;
  const cap = location.first_run_cap;
  if (cap == null || !Number.isFinite(cap) || cap <= 0) return null;
  return Math.floor(cap);
}

/**
 * Whether dunning may chase this invoice.
 *
 * An invoice that was already overdue when the branch went live is the
 * garage's own historic debt — often imported, often already settled off-system
 * — so it is never chased automatically unless the owner opts in. Permanent,
 * not a first-day rule: a 24-hour suppression would just move the blast.
 */
export function mayChaseInvoice(
  location: FirstRunPolicy,
  invoiceDueAt: string | null | undefined,
): boolean {
  if (location.chase_prelive_debt) return true;
  if (!location.live_at || !invoiceDueAt) return true;
  const due = new Date(invoiceDueAt).getTime();
  const live = new Date(location.live_at).getTime();
  if (Number.isNaN(due) || Number.isNaN(live)) return true;
  return due >= live;
}
