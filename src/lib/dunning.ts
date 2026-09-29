// Pure dunning-cadence logic — no I/O, unit-tested. Decides whether an overdue
// invoice is due its next reminder and which stage that is, from how many days
// it's overdue and how many reminders already went out.
//
// Cadence is days-overdue thresholds: [1, 7, 14] means remind at 1 day overdue,
// again at 7, again at 14, then stop (capped at cadence.length reminders).

export const DEFAULT_DUNNING_CADENCE = [1, 7, 14] as const;

export type DunningDecision = { send: boolean; stage: number };

/**
 * `daysSinceLast` — whole UTC days since the previous reminder (null = none
 * sent or unknown). Every stage after the first also waits the cadence's own
 * spacing since the last send: [1, 7, 14] means 6 days before stage 2 and 7
 * before stage 3. Without it, an invoice already past every threshold (one
 * that went overdue while the scheduler was down, or an old debt) got all
 * three reminders on three consecutive days. For an invoice dunned on time
 * the spacing is met exactly when the threshold is, so nothing changes.
 */
export function dunningStage(
  daysOverdue: number,
  dunningCount: number,
  cadence: readonly number[] = DEFAULT_DUNNING_CADENCE,
  daysSinceLast: number | null = null,
): DunningDecision {
  // All stages already sent → done.
  if (dunningCount >= cadence.length) {
    return { send: false, stage: dunningCount };
  }
  // The next stage fires once its days-overdue threshold is reached. Because
  // dunningCount advances after each send and later thresholds are larger, a
  // same-day re-run won't re-send the same stage.
  const threshold = cadence[dunningCount];
  if (daysOverdue < threshold) {
    return { send: false, stage: dunningCount };
  }
  if (dunningCount > 0 && daysSinceLast !== null && daysSinceLast < stageGapDays(dunningCount, cadence)) {
    return { send: false, stage: dunningCount };
  }
  return { send: true, stage: dunningCount + 1 };
}

/** Minimum days between reminder `dunningCount` and the next (at least 1). */
export function stageGapDays(dunningCount: number, cadence: readonly number[] = DEFAULT_DUNNING_CADENCE): number {
  if (dunningCount <= 0) return 0;
  return Math.max(1, cadence[dunningCount] - cadence[dunningCount - 1]);
}

/**
 * Whole UTC calendar days since the last reminder, or null if none. Calendar
 * days, not elapsed hours: the cron fires at roughly the same minute each day,
 * so an elapsed-time count would read 5.99 days a week later and slip a day.
 */
export function daysSinceLastDunning(lastDunnedAt: string | null | undefined, now: Date = new Date()): number | null {
  if (!lastDunnedAt) return null;
  const last = new Date(lastDunnedAt);
  if (Number.isNaN(last.getTime())) return null;
  const dayMs = 24 * 60 * 60 * 1000;
  const utcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((utcDay(now) - utcDay(last)) / dayMs);
}

// Whole days an invoice is overdue (>= 0), from its due date to `now`.
export function daysOverdue(dueAt: string | Date, now: Date = new Date()): number {
  const due = typeof dueAt === "string" ? new Date(dueAt) : dueAt;
  const ms = now.getTime() - due.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}
