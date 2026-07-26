// Customer "command deck" scoring — the derived layer behind /staff/customers.
//
// Everything here is a PURE function of facts already in the database (due
// dates, balances, visit history, reminder engagement, open quotes). No AI call
// and no clock read of its own: callers pass `now`, so a page render, a unit
// test and a cron all agree. The brief text is templated from the same rules
// that pick the signal, which keeps the copy honest — it can only say things
// the numbers support.

export type SegmentKey = "all" | "attention" | "mot30" | "owes" | "plan" | "quiet";

/** The one-word verdict shown in the list's AI SIGNAL column. */
export type AiSignal = "book" | "churn" | "quote" | "quiet" | null;

export type DueKind = "mot" | "service" | "tax";

export type NextDue = {
  kind: DueKind;
  /** Whole days from `now` until the date. Negative = overdue. */
  days: number;
  vehicleId: string;
  registration: string;
};

/**
 * What an action button does when clicked. Only kinds that map onto an existing
 * server action / route are ever produced — the deck never offers a button that
 * cannot do the thing it says.
 */
export type InsightAction =
  | { key: string; label: string; kind: "reminder"; vehicleId: string; reminderType: "mot" | "service" }
  | { key: string; label: string; kind: "draft"; topic: string }
  | { key: string; label: string; kind: "plan" }
  | { key: string; label: string; kind: "link"; href: string };

export type InsightVehicle = {
  id: string;
  registration: string;
  motExpiry: string | null;
  serviceDue: string | null;
  taxDue: string | null;
};

export type InsightInput = {
  fullName: string | null;
  vehicles: InsightVehicle[];
  /** Open invoiced £ — sum of (total − amount_paid) over unpaid sent invoices. */
  balance: number;
  /** Sum of paid invoice totals. */
  lifetimeValue: number;
  /** Completed jobs. */
  visitCount: number;
  /** ISO timestamp of the most recent completed job / paid invoice. */
  lastVisitAt: string | null;
  createdAt: string;
  hasPlan: boolean;
  /** Most recent quote still awaiting a customer response, if any. */
  openQuote: { id: string; total: number; sentAt: string | null } | null;
  /** Reminder engagement over the scan window. */
  remindersSent: number;
  remindersOpened: number;
  lastReminderAt: string | null;
  now: number;
};

export type CustomerInsight = {
  /** 0–100. Higher = healthier. Drives the ring colour and the default sort. */
  health: number;
  segments: SegmentKey[];
  nextDue: NextDue | null;
  aiSignal: AiSignal;
  brief: string;
  actions: InsightAction[];
};

const DAY_MS = 86_400_000;

/**
 * One clock read per request, taken here rather than in a page body — the
 * react-hooks purity rule (rightly) rejects a bare `Date.now()` during render.
 * Every scored value on a page derives from this single reading, so the whole
 * screen agrees with itself.
 */
export function scanClock(): number {
  return Date.now();
}

/** Whole days from `now` to an ISO date. Negative = in the past. */
export function daysUntil(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - now) / DAY_MS);
}

export function daysSince(iso: string | null, now: number): number | null {
  const d = daysUntil(iso, now);
  return d === null ? null : -d;
}

/** Ring / avatar-border colour band. Matches the design's 70 / 40 thresholds. */
export function healthColor(health: number): string {
  if (health >= 70) return "var(--color-ws-green)";
  if (health >= 40) return "var(--color-ws-amber)";
  return "var(--color-ws-red)";
}

export type Urgency = "red" | "amber" | "green" | "none";

/** ≤30 days or overdue = red, ≤60 = amber, beyond = green, unknown = none. */
export function dueUrgency(days: number | null): Urgency {
  if (days === null) return "none";
  if (days <= 30) return "red";
  if (days <= 60) return "amber";
  return "green";
}

const DUE_LABEL: Record<DueKind, string> = { mot: "MOT", service: "Service", tax: "Road tax" };

/** "MOT · 17d" / "Service · overdue 12d" — the NEXT DUE cell. */
export function formatNextDue(due: NextDue | null): string {
  if (!due) return "—";
  return due.days < 0
    ? `${DUE_LABEL[due.kind]} · overdue ${-due.days}d`
    : `${DUE_LABEL[due.kind]} · ${due.days}d`;
}

/** "5 wks ago" / "11 mos ago" / "never" — the LAST IN cell. */
export function formatAgo(iso: string | null, now: number): string {
  const days = daysSince(iso, now);
  if (days === null) return "never";
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} wks ago`;
  if (days < 365) return `${Math.round(days / 30)} mos ago`;
  const years = Math.floor(days / 365);
  return years === 1 ? "1 yr ago" : `${years} yrs ago`;
}

/** Soonest of MOT / service / tax across every vehicle on file. */
export function nextDueFor(vehicles: InsightVehicle[], now: number): NextDue | null {
  let best: NextDue | null = null;
  for (const v of vehicles) {
    const candidates: [DueKind, string | null][] = [
      ["mot", v.motExpiry],
      ["service", v.serviceDue],
      ["tax", v.taxDue],
    ];
    for (const [kind, iso] of candidates) {
      const days = daysUntil(iso, now);
      if (days === null) continue;
      if (!best || days < best.days) {
        best = { kind, days, vehicleId: v.id, registration: v.registration };
      }
    }
  }
  return best;
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(n)));

/**
 * Health 0–100, built by subtracting evidence of neglect from a neutral 72.
 *
 * Deliberately blunt: a garage owner has to be able to look at a red ring and
 * name the reason without opening anything. Each penalty maps 1:1 onto a line
 * the brief is allowed to say.
 */
export function healthScore(input: InsightInput): number {
  const { now } = input;
  let score = 72;

  const due = nextDueFor(input.vehicles, now);
  if (due) {
    if (due.days < 0) score -= Math.min(34, 18 + Math.abs(due.days) / 6);
    else if (due.days <= 14) score -= 16;
    else if (due.days <= 30) score -= 10;
    else if (due.days <= 60) score -= 3;
    else score += 6;
  }

  const sinceVisit = daysSince(input.lastVisitAt, now);
  if (sinceVisit === null) {
    // Never been in. New records aren't unhealthy; long-dormant ones are.
    const sinceAdded = daysSince(input.createdAt, now) ?? 0;
    score -= sinceAdded > 120 ? 18 : 4;
  } else if (sinceVisit > 540) score -= 26;
  else if (sinceVisit > 365) score -= 20;
  else if (sinceVisit > 270) score -= 13;
  else if (sinceVisit > 180) score -= 6;
  else if (sinceVisit <= 60) score += 8;

  // Loyalty: repeat business is the strongest positive signal a garage has.
  if (input.visitCount >= 8) score += 12;
  else if (input.visitCount >= 4) score += 7;
  else if (input.visitCount >= 2) score += 3;

  if (input.hasPlan) score += 9;

  if (input.balance > 0) score -= input.balance >= 500 ? 14 : 8;

  // Reminders that land but never get opened = a relationship going cold.
  if (input.remindersSent >= 3) {
    const openRate = input.remindersOpened / input.remindersSent;
    if (openRate === 0) score -= 10;
    else if (openRate >= 0.6) score += 5;
  }

  if (input.openQuote) score -= 5;

  return clamp(score);
}

/** Visits per year over the customer's life so far — used for "going quiet". */
function visitCadencePerYear(input: InsightInput): number | null {
  const ageDays = daysSince(input.createdAt, input.now);
  if (ageDays === null || ageDays < 400 || input.visitCount < 2) return null;
  return input.visitCount / (ageDays / 365);
}

export function segmentsFor(input: InsightInput, health: number): SegmentKey[] {
  const segments: SegmentKey[] = [];
  const sinceVisit = daysSince(input.lastVisitAt, input.now);

  if (health < 50) segments.push("attention");

  // MOT only — a vehicle with no MOT date on file never lands in this chip
  // even when something else is imminent; "needs attention" covers that case.
  const motDays = input.vehicles
    .map((v) => daysUntil(v.motExpiry, input.now))
    .filter((d): d is number => d !== null);
  if (motDays.some((d) => d <= 30)) segments.push("mot30");

  if (input.balance > 0) segments.push("owes");
  if (input.hasPlan) segments.push("plan");

  const cadence = visitCadencePerYear(input);
  const overdueVsCadence = cadence !== null && sinceVisit !== null && sinceVisit > (365 / cadence) * 1.6;
  if ((sinceVisit !== null && sinceVisit > 300) || overdueVsCadence) segments.push("quiet");

  return segments;
}

export function signalFor(input: InsightInput, segments: SegmentKey[]): AiSignal {
  const sinceVisit = daysSince(input.lastVisitAt, input.now);
  const due = nextDueFor(input.vehicles, input.now);

  // Order matters: the most actionable thing wins the single chip.
  if (sinceVisit !== null && sinceVisit > 365 && input.visitCount >= 2) return "churn";
  if (input.openQuote) return "quote";
  if (due && due.days <= 30 && (sinceVisit === null || sinceVisit <= 365)) return "book";
  if (segments.includes("quiet")) return "quiet";
  return null;
}

function firstNameOf(fullName: string | null): string {
  const first = (fullName ?? "").trim().split(/\s+/)[0];
  return first || "This customer";
}

const gbp = (n: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);

/** Lowercased due phrase for mid-sentence use: "MOT due in 17 days". */
function duePhrase(due: NextDue): string {
  const label = due.kind === "mot" ? "MOT" : due.kind === "service" ? "service" : "road tax";
  if (due.days < 0) return `${label} ${-due.days} days overdue on ${due.registration}`;
  if (due.days === 0) return `${label} due today on ${due.registration}`;
  return `${label} due in ${due.days} days on ${due.registration}`;
}

/**
 * The `// AI BRIEF` paragraph. Templated, not generated: every clause is
 * traceable to a number above, so it can never claim engagement or history the
 * record doesn't have.
 */
export function briefFor(input: InsightInput, signal: AiSignal): string {
  const first = firstNameOf(input.fullName);
  const due = nextDueFor(input.vehicles, input.now);
  const sinceVisit = daysSince(input.lastVisitAt, input.now);
  const opens =
    input.remindersSent >= 2 && input.remindersOpened / input.remindersSent >= 0.6
      ? ` ${first} opens the reminders you send.`
      : "";
  const owed = input.balance > 0 ? ` ${gbp(input.balance)} is still outstanding on account.` : "";

  if (signal === "churn") {
    const gap = formatAgo(input.lastVisitAt, input.now).replace(" ago", "");
    return `No visit in ${gap} after ${input.visitCount} previous ${input.visitCount === 1 ? "visit" : "visits"}${
      input.lifetimeValue > 0 ? ` worth ${gbp(input.lifetimeValue)}` : ""
    }. A personal win-back note is worth more here than another automated reminder.${owed}`;
  }

  if (signal === "quote" && input.openQuote) {
    const waiting = daysSince(input.openQuote.sentAt, input.now);
    const age = waiting !== null && waiting > 0 ? ` for ${waiting} ${waiting === 1 ? "day" : "days"}` : "";
    return `A ${gbp(input.openQuote.total)} quote has been sitting with ${first}${age} with no answer. Following up while it's still fresh is the single highest-value action on this record.${owed}`;
  }

  if (signal === "book") {
    return `${first} has ${due ? duePhrase(due) : "work coming due"}${
      sinceVisit !== null && sinceVisit <= 400 ? ` and was last in ${formatAgo(input.lastVisitAt, input.now)}` : ""
    }.${opens} A nudge now is the difference between this booking and a garage down the road.${owed}`;
  }

  if (signal === "quiet") {
    return `${first}'s visits have slowed against their own pattern${
      sinceVisit !== null ? ` — last in ${formatAgo(input.lastVisitAt, input.now)}` : ""
    }. A light-touch check-in usually costs nothing and keeps the record warm.${owed}`;
  }

  if (input.balance > 0) {
    return `Nothing due soon for ${first}, but ${gbp(input.balance)} is outstanding on account. Worth a statement before it ages further.`;
  }

  return `Nothing urgent for ${first}. Next due: ${due ? duePhrase(due) : "nothing on file"}.${opens} This record will be flagged here when acting on it is worth your time.`;
}

export function actionsFor(input: InsightInput, signal: AiSignal): InsightAction[] {
  const first = firstNameOf(input.fullName);
  const due = nextDueFor(input.vehicles, input.now);
  const actions: InsightAction[] = [];

  // A reminder button is only offered when the vehicle actually carries the
  // date that reminder sends against (sendReminder rejects otherwise).
  const remindable =
    due && (due.kind === "mot" || due.kind === "service")
      ? ({
          key: `reminder-${due.kind}`,
          label: due.days < 0 ? `Send overdue ${due.kind === "mot" ? "MOT" : "service"} reminder` : `Send ${due.kind === "mot" ? "MOT" : "service"} reminder now`,
          kind: "reminder" as const,
          vehicleId: due.vehicleId,
          reminderType: due.kind,
        })
      : null;

  if (signal === "churn") {
    actions.push({
      key: "draft-winback",
      label: "Draft win-back message",
      kind: "draft",
      topic: `A warm win-back note — ${first} hasn't been in for ${formatAgo(input.lastVisitAt, input.now).replace(" ago", "")}. Invite them back without being pushy.`,
    });
    if (remindable) actions.push(remindable);
    if (!input.hasPlan) actions.push({ key: "plan", label: "Invite to a service plan", kind: "plan" });
  } else if (signal === "quote" && input.openQuote) {
    actions.push({
      key: "draft-quote",
      label: "Send quote follow-up",
      kind: "draft",
      topic: `Follow up on the ${gbp(input.openQuote.total)} quote still awaiting an answer. Offer to talk it through.`,
    });
    actions.push({ key: "open-quote", label: "Open the quote", kind: "link", href: `/staff/quotes/${input.openQuote.id}` });
    if (remindable) actions.push(remindable);
  } else if (signal === "book") {
    if (remindable) actions.push(remindable);
    actions.push({
      key: "draft-book",
      label: "Draft a personal note",
      kind: "draft",
      topic: due
        ? `A short personal note about the ${duePhrase(due)}, offering a slot.`
        : "A short personal note offering a booking slot.",
    });
    if (!input.hasPlan) actions.push({ key: "plan", label: "Invite to a service plan", kind: "plan" });
  } else if (signal === "quiet") {
    actions.push({
      key: "draft-checkin",
      label: "Draft a check-in message",
      kind: "draft",
      topic: `A light-touch check-in — no hard sell, just asking how the car is doing.`,
    });
    if (remindable) actions.push(remindable);
    if (!input.hasPlan) actions.push({ key: "plan", label: "Invite to a service plan", kind: "plan" });
  } else {
    if (remindable) actions.push(remindable);
    if (input.balance > 0) actions.push({ key: "draft-balance", label: "Chase the outstanding balance", kind: "draft", topic: `A polite reminder that ${gbp(input.balance)} is outstanding on their account.` });
    if (!input.hasPlan) actions.push({ key: "plan", label: "Invite to a service plan", kind: "plan" });
    if (actions.length === 0) {
      actions.push({ key: "draft-generic", label: "Draft a message", kind: "draft", topic: "" });
    }
  }

  return actions.slice(0, 3);
}

export function computeInsight(input: InsightInput): CustomerInsight {
  const health = healthScore(input);
  const segments = segmentsFor(input, health);
  const aiSignal = signalFor(input, segments);
  return {
    health,
    segments,
    nextDue: nextDueFor(input.vehicles, input.now),
    aiSignal,
    brief: briefFor(input, aiSignal),
    actions: actionsFor(input, aiSignal),
  };
}

// ── Segment + signal presentation ──────────────────────────────────────────

export const SEGMENTS: { key: SegmentKey; label: string; dot: string }[] = [
  { key: "all", label: "All", dot: "var(--color-ws-text-2)" },
  { key: "attention", label: "Needs attention", dot: "var(--color-ws-red)" },
  { key: "mot30", label: "MOT ≤ 30 days", dot: "var(--color-ws-amber)" },
  { key: "owes", label: "Owes money", dot: "var(--color-ws-amber)" },
  { key: "plan", label: "Plan members", dot: "var(--color-ws-green)" },
  { key: "quiet", label: "Going quiet", dot: "var(--color-ws-purple)" },
];

export const SIGNAL_LABEL: Record<Exclude<AiSignal, null>, string> = {
  book: "Likely to book",
  churn: "High churn risk",
  quote: "Quote pending",
  quiet: "Going quiet",
};

export const SIGNAL_TONE: Record<Exclude<AiSignal, null>, "green" | "red" | "amber" | "purple"> = {
  book: "green",
  churn: "red",
  quote: "amber",
  quiet: "purple",
};

export type SortKey = "attention" | "recent" | "name" | "balance";

export function isSortKey(value: string | undefined): value is SortKey {
  return value === "attention" || value === "recent" || value === "name" || value === "balance";
}

export function isSegmentKey(value: string | undefined): value is SegmentKey {
  return SEGMENTS.some((s) => s.key === value);
}
