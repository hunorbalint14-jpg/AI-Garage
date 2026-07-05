// Pure logic + shared types for the staff dashboard (src/app/staff/page.tsx).
// Extracted from the page so it can be unit-tested; rendering stays in
// src/components/staff/dashboard/*.

import type { PermissionKey } from "@/app/staff/staff-members/constants";

export type OrgRole = "owner" | "admin" | "accountant" | null;

export type AttentionVehicle = {
  id: string;
  registration: string;
  make: string | null;
  model: string | null;
  mot_expiry: string | null;
  service_due: string | null;
  customer: { id: string; full_name: string | null } | null;
};

export type BookingSlot = {
  id: string;
  scheduledAt: string;
  durationMinutes: number;
  type: string;
  status: string;
  customerName: string | null;
  registration: string | null;
  bayId: string | null;
};

export type BayRow = { id: string; name: string; description: string | null };

// Shape of the dashboard_stats RPC payload (one round-trip replacing the
// previous 15 parallel queries). Series semantics documented in the migration.
export type DashboardStats = {
  total_customers: number;
  total_vehicles: number;
  reminders_month: number;
  active_jobs: number;
  uninvoiced_jobs: number;
  invoices_open: { draft_count: number; draft_total: number; sent_count: number; sent_total: number };
  expiring_quotes: { count: number; total: number };
  attention_vehicles: AttentionVehicle[];
  today_bookings: {
    id: string;
    scheduled_at: string;
    duration_minutes: number | null;
    type: string;
    status: string;
    bay_id: string | null;
    customer: { id: string; full_name: string | null } | null;
    vehicle: { registration: string } | null;
  }[];
  bays: BayRow[];
  business_hours: { start: number | null; end: number | null } | null;
  week_revenue_by_day: Record<string, number>;
  customers_added_per_week: number[];
  vehicles_added_per_week: number[];
  reminders_per_day: number[];
};

// dashboard_stats_v2 additions. The gated sections (wip / finance /
// week_worked / my_day) come back null when the call excludes them — or when
// the whole RPC errors and the page falls back to EMPTY_STATS; render code
// must treat null as "absent", never crash.
export type DashboardStatsV2 = DashboardStats & {
  quotes_pending: { count: number; total: number };
  courtesy: { out_count: number; overdue_count: number };
  low_stock: number;
  no_show_today: number;
  wip: { job_count: number; total: number } | null;
  finance: {
    revenue_month: number;
    total_paid: number;
    paid_count: number;
    aged_overdue: number;
  } | null;
  week_worked: { minutes: number; techs: number } | null;
  my_day: {
    bookings: {
      id: string;
      scheduled_at: string;
      duration_minutes: number | null;
      type: string;
      status: string;
      registration: string | null;
      customer_name: string | null;
      bay_id: string | null;
    }[];
    jobs: {
      id: string;
      description: string | null;
      status: string;
      registration: string | null;
      customer_name: string | null;
    }[];
    open_entry: {
      job_id: string;
      status: string;
      active_minutes: number;
      segment_started_at: string | null;
      job_description: string | null;
      registration: string | null;
    } | null;
  } | null;
};

export const EMPTY_STATS: DashboardStats = {
  total_customers: 0,
  total_vehicles: 0,
  reminders_month: 0,
  active_jobs: 0,
  uninvoiced_jobs: 0,
  invoices_open: { draft_count: 0, draft_total: 0, sent_count: 0, sent_total: 0 },
  expiring_quotes: { count: 0, total: 0 },
  attention_vehicles: [],
  today_bookings: [],
  bays: [],
  business_hours: null,
  week_revenue_by_day: {},
  customers_added_per_week: [],
  vehicles_added_per_week: [],
  reminders_per_day: [],
};

export const EMPTY_STATS_V2: DashboardStatsV2 = {
  ...EMPTY_STATS,
  quotes_pending: { count: 0, total: 0 },
  courtesy: { out_count: 0, overdue_count: 0 },
  low_stock: 0,
  no_show_today: 0,
  wip: null,
  finance: null,
  week_worked: null,
  my_day: null,
};

// ---------------------------------------------------------------------------
// Role-aware widget visibility
// ---------------------------------------------------------------------------

// hasPermission() returns false for accountants on every key (they carry no
// location permissions), yet they are org-wide finance readers. Mirror the
// ACCOUNTANT_ITEMS nav allow-list for the finance widgets only.
export const ACCOUNTANT_FINANCE_KEYS: ReadonlySet<PermissionKey> = new Set([
  "revenue",
  "invoices",
  "reports",
] satisfies PermissionKey[]);

export function canFinance(
  orgRole: OrgRole,
  hasPerm: (key: PermissionKey) => boolean,
  key: PermissionKey,
): boolean {
  return orgRole === "accountant" ? ACCOUNTANT_FINANCE_KEYS.has(key) : hasPerm(key);
}

export type DashboardWidgets = {
  /** Bookings-today tile, TodaySchedule, active-jobs tile, no-shows tile, courtesy tile. */
  bookingsOps: boolean;
  /** Quotes-awaiting-approval tile. */
  quotesPending: boolean;
  /** Low-stock tile. */
  lowStock: boolean;
  /** Overdue tile, attention queue, reminders tile, header overdue copy. */
  reminders: boolean;
  /** Revenue-week tile, weekly chart, WIP tile. */
  revenue: boolean;
  /** Open-invoices tile. */
  invoices: boolean;
  /** Customers + Vehicles cumulative tiles (growth vanity — owner/admin only). */
  growth: boolean;
  /** Month revenue / avg invoice / aged debtors row (any org role). */
  ownerRow: boolean;
  /** Utilisation tile — owner/admin only (ops metric, not part of the accountant's finance view). */
  utilisation: boolean;
};

export function dashboardWidgets(
  orgRole: OrgRole,
  hasPerm: (key: PermissionKey) => boolean,
): DashboardWidgets {
  return {
    bookingsOps: hasPerm("bookings"),
    quotesPending: hasPerm("quotes_approve_view"),
    lowStock: hasPerm("products"),
    reminders: hasPerm("reminders"),
    revenue: canFinance(orgRole, hasPerm, "revenue"),
    invoices: canFinance(orgRole, hasPerm, "invoices"),
    growth: orgRole === "owner" || orgRole === "admin",
    ownerRow: orgRole !== null,
    utilisation: orgRole === "owner" || orgRole === "admin",
  };
}

export function anyWidgetVisible(w: DashboardWidgets): boolean {
  return Object.values(w).some(Boolean);
}

export function dueDays(d: string, nowMs: number = Date.now()): number {
  return Math.ceil((new Date(d).getTime() - nowMs) / (1000 * 60 * 60 * 24));
}

// Cumulative total at the end of each of the last N weeks, oldest first,
// reconstructed by walking back from today's total using the per-week added
// counts from dashboard_stats (oldest week first).
export function cumulativeWeeklySeries(addedPerWeek: number[], total: number): number[] {
  const series = new Array<number>(addedPerWeek.length).fill(0);
  let running = total;
  for (let i = addedPerWeek.length - 1; i >= 0; i--) {
    series[i] = running;
    running -= addedPerWeek[i];
  }
  return series;
}

export function fmtGBP(n: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(n);
}

// Overdue = MOT or service past due; urgent = due within 14 days and not
// already overdue. Mutually exclusive; remaining attention vehicles are
// "upcoming" (due within the RPC's 60-day window).
export function classifyAttention(
  vehicles: AttentionVehicle[],
  nowMs: number = Date.now(),
): { overdue: AttentionVehicle[]; urgent: AttentionVehicle[] } {
  const overdue = vehicles.filter((v) => {
    const m = v.mot_expiry ? dueDays(v.mot_expiry, nowMs) : null;
    const s = v.service_due ? dueDays(v.service_due, nowMs) : null;
    return (m !== null && m < 0) || (s !== null && s < 0);
  });
  const urgent = vehicles.filter((v) => {
    const m = v.mot_expiry ? dueDays(v.mot_expiry, nowMs) : null;
    const s = v.service_due ? dueDays(v.service_due, nowMs) : null;
    return (
      !overdue.includes(v) &&
      ((m !== null && m >= 0 && m <= 14) || (s !== null && s >= 0 && s <= 14))
    );
  });
  return { overdue, urgent };
}

export type PriorityItem = {
  n: string;
  title: string;
  body: string;
  impact: string;
  urgency: string;
  href: string;
};

// Which priority actions this user may see; each maps to the permission of
// the page the action links to (invoices → canFinance('invoices'), quotesSend
// → quotes_send, reminders → reminders; revenue only picks the fallback href).
export type PriorityGates = {
  invoices: boolean;
  quotesSend: boolean;
  reminders: boolean;
  revenue: boolean;
};

export const ALL_PRIORITY_GATES: PriorityGates = {
  invoices: true,
  quotesSend: true,
  reminders: true,
  revenue: true,
};

export function buildPriorityItems(
  input: {
    uninvoicedJobs: number;
    expiringQuotes: { count: number; total: number };
    invoicesOpen: { draft_count: number; draft_total: number; sent_count: number; sent_total: number };
    overdueCount: number;
    urgentCount: number;
  },
  gates: PriorityGates = ALL_PRIORITY_GATES,
): PriorityItem[] {
  const { uninvoicedJobs, expiringQuotes, invoicesOpen, overdueCount, urgentCount } = input;
  const items: PriorityItem[] = [];

  if (gates.invoices && uninvoicedJobs > 0) {
    items.push({
      n: String(items.length + 1).padStart(2, "0"),
      title: `Invoice ${uninvoicedJobs} finished job${uninvoicedJobs !== 1 ? "s" : ""}`,
      body: "Work is done but nothing has been billed yet.",
      impact: "unbilled work",
      urgency: "now",
      href: "/staff/jobs",
    });
  }
  if (gates.quotesSend && expiringQuotes.count > 0) {
    items.push({
      n: String(items.length + 1).padStart(2, "0"),
      title: `${expiringQuotes.count} quote${expiringQuotes.count !== 1 ? "s" : ""} expiring within 3 days`,
      body: "Customer hasn't responded. A nudge now beats a re-quote later.",
      impact: fmtGBP(Number(expiringQuotes.total)),
      urgency: "now",
      href: "/staff/quotes",
    });
  }
  if (gates.reminders && overdueCount > 0) {
    items.push({
      n: String(items.length + 1).padStart(2, "0"),
      title: `Send reminders — ${overdueCount} overdue vehicle${overdueCount !== 1 ? "s" : ""}`,
      body: "MOT or service past due. Draft reminders in one click.",
      impact: `~${overdueCount * 2} bookings`,
      urgency: "now",
      href: "/staff/reminders",
    });
  }
  // Draft invoices were lumped in with sent ones under "chase unpaid" — but a
  // draft has never reached the customer; the action is "send it", not "chase it".
  if (gates.invoices && invoicesOpen.draft_count > 0) {
    const value = Number(invoicesOpen.draft_total);
    items.push({
      n: String(items.length + 1).padStart(2, "0"),
      title: `Send ${invoicesOpen.draft_count} draft invoice${invoicesOpen.draft_count !== 1 ? "s" : ""}`,
      body: `Drafted but never sent — the customer can't pay what they haven't seen.`,
      impact: fmtGBP(value),
      urgency: "today",
      href: "/staff/invoices",
    });
  }
  if (gates.invoices && invoicesOpen.sent_count > 0) {
    const value = Number(invoicesOpen.sent_total);
    items.push({
      n: String(items.length + 1).padStart(2, "0"),
      title: `Chase ${invoicesOpen.sent_count} unpaid invoice${invoicesOpen.sent_count !== 1 ? "s" : ""}`,
      body: `Total outstanding: ${fmtGBP(value)}. Send friendly chasers.`,
      impact: fmtGBP(value),
      urgency: "today",
      href: "/staff/invoices",
    });
  }
  if (gates.reminders && urgentCount > 0) {
    items.push({
      n: String(items.length + 1).padStart(2, "0"),
      title: `Book ${urgentCount} vehicle${urgentCount !== 1 ? "s" : ""} due within 14 days`,
      body: "Contact before they book elsewhere.",
      impact: `+${fmtGBP(urgentCount * 120)} est`,
      urgency: "this week",
      href: "/staff/reminders",
    });
  }
  if (items.length === 0) {
    items.push({
      n: "01",
      title: "All caught up",
      body: gates.revenue
        ? "No urgent actions today. Review revenue or plan campaigns."
        : "No urgent actions today.",
      impact: "—",
      urgency: "today",
      href: gates.revenue ? "/staff/revenue" : "/staff/bookings",
    });
  }
  return items;
}
