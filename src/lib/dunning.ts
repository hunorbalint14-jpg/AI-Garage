// Pure dunning-cadence logic — no I/O, unit-tested. Decides whether an overdue
// invoice is due its next reminder and which stage that is, from how many days
// it's overdue and how many reminders already went out.
//
// Cadence is days-overdue thresholds: [1, 7, 14] means remind at 1 day overdue,
// again at 7, again at 14, then stop (capped at cadence.length reminders).

export const DEFAULT_DUNNING_CADENCE = [1, 7, 14] as const;

export type DunningDecision = { send: boolean; stage: number };

export function dunningStage(
  daysOverdue: number,
  dunningCount: number,
  cadence: readonly number[] = DEFAULT_DUNNING_CADENCE,
): DunningDecision {
  // All stages already sent → done.
  if (dunningCount >= cadence.length) {
    return { send: false, stage: dunningCount };
  }
  // The next stage fires once its days-overdue threshold is reached. Because
  // dunningCount advances after each send and later thresholds are larger, a
  // same-day re-run won't re-send the same stage.
  const threshold = cadence[dunningCount];
  if (daysOverdue >= threshold) {
    return { send: true, stage: dunningCount + 1 };
  }
  return { send: false, stage: dunningCount };
}

// Whole days an invoice is overdue (>= 0), from its due date to `now`.
export function daysOverdue(dueAt: string | Date, now: Date = new Date()): number {
  const due = typeof dueAt === "string" ? new Date(dueAt) : dueAt;
  const ms = now.getTime() - due.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}
