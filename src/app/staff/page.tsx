import Link from "next/link";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type Vehicle = {
  id: string;
  registration: string;
  make: string | null;
  model: string | null;
  mot_expiry: string | null;
  service_due: string | null;
  customer: { id: string; full_name: string | null } | null;
};

type BookingSlot = {
  id: string;
  scheduledAt: string;
  durationMinutes: number;
  type: string;
  status: string;
  customerName: string | null;
  registration: string | null;
  bayId: string | null;
};

type BayRow = { id: string; name: string; description: string | null };

// Shape of the dashboard_stats RPC payload (one round-trip replacing the
// previous 15 parallel queries). Series semantics documented in the migration.
type DashboardStats = {
  total_customers: number;
  total_vehicles: number;
  reminders_month: number;
  active_jobs: number;
  uninvoiced_jobs: number;
  invoices_open: { draft_count: number; draft_total: number; sent_count: number; sent_total: number };
  expiring_quotes: { count: number; total: number };
  attention_vehicles: Vehicle[];
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

const EMPTY_STATS: DashboardStats = {
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

const BOOKING_STATUS: Record<string, { bg: string; border: string; accent: string }> = {
  scheduled:   { bg: "var(--muted)", border: "var(--border)", accent: "var(--muted-foreground)" },
  in_progress: { bg: "#3a2c14", border: "#ffb020", accent: "#ffb020" },
  complete:    { bg: "#13301f", border: "#5fdd9d", accent: "#5fdd9d" },
  cancelled:   { bg: "#3a1a1a", border: "#ff5b5b", accent: "#ff5b5b" },
  no_show:     { bg: "#2a1a2a", border: "#9a4a9a", accent: "#9a4a9a" },
};

function TodaySchedule({
  bookings,
  bays,
  now,
  workStart = 8,
  workEnd = 18,
}: {
  bookings: BookingSlot[];
  bays: BayRow[];
  now: Date;
  workStart?: number;
  workEnd?: number;
}) {
  const DAY_START = Math.max(0, workStart - 1);
  const DAY_END = Math.min(23, workEnd + 1);
  const DAY_SPAN = DAY_END - DAY_START;
  const PX_PER_HOUR = 90;
  const TIMELINE_W = DAY_SPAN * PX_PER_HOUR;
  const nowH = now.getHours() + now.getMinutes() / 60;
  const nowPx = (nowH - DAY_START) * PX_PER_HOUR;
  const showNow = nowH >= DAY_START && nowH <= DAY_START + DAY_SPAN;
  const hours = Array.from({ length: DAY_SPAN + 1 }, (_, i) => i + DAY_START);
  const padStart = `${String(DAY_START).padStart(2, "0")}:00`;
  const padEnd = `${String(DAY_END).padStart(2, "0")}:00`;
  const LABEL_W = 130;

  // Group bookings by bayId
  const byBay = new Map<string | null, BookingSlot[]>();
  for (const b of bookings) {
    const key = b.bayId ?? null;
    if (!byBay.has(key)) byBay.set(key, []);
    byBay.get(key)!.push(b);
  }

  type ScheduleRow = { id: string | null; name: string; sub: string | null; items: BookingSlot[] };
  const rows: ScheduleRow[] =
    bays.length > 0
      ? [
          ...bays.map((bay) => ({
            id: bay.id,
            name: bay.name,
            sub: bay.description,
            items: byBay.get(bay.id) ?? [],
          })),
          ...(byBay.has(null) && (byBay.get(null)?.length ?? 0) > 0
            ? [{ id: null, name: "Unassigned", sub: null, items: byBay.get(null) ?? [] }]
            : []),
        ]
      : [{ id: null, name: "All bookings", sub: null, items: bookings }];

  function renderBlock(b: BookingSlot) {
    const startDate = new Date(b.scheduledAt);
    const startH = startDate.getHours() + startDate.getMinutes() / 60;
    const leftPx = Math.max(0, (startH - DAY_START) * PX_PER_HOUR);
    const widthPx = Math.max(4, (b.durationMinutes / 60) * PX_PER_HOUR);
    if (leftPx >= TIMELINE_W) return null;
    const s = BOOKING_STATUS[b.status] ?? BOOKING_STATUS.scheduled;
    const isNarrow = widthPx < 40;

    const endDate = new Date(startDate.getTime() + b.durationMinutes * 60000);
    const fmt = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    const timeRange = `${fmt(startDate)} – ${fmt(endDate)}`;
    const durStr = b.durationMinutes >= 60
      ? `${Math.floor(b.durationMinutes / 60)}h${b.durationMinutes % 60 ? ` ${b.durationMinutes % 60}m` : ""}`
      : `${b.durationMinutes}m`;
    const tooltipSide = leftPx > TIMELINE_W * 0.55 ? { right: 0 } : { left: 0 };

    return (
      <Link
        key={b.id}
        href={`/staff/bookings/${b.id}`}
        className={`booking-block absolute inset-y-1.5 overflow-visible rounded-[2px] ${isNarrow ? "p-0" : "px-1.5 py-1"}`}
        style={{
          left: leftPx,
          width: widthPx,
          background: s.bg,
          border: `1px solid ${s.border}`,
          borderLeft: `3px solid ${s.accent}`,
        }}
      >
        {!isNarrow && (
          <>
            {b.registration && (
              <div className="truncate font-mono text-[10px] font-bold leading-[1.2] tracking-[0.04em]" style={{ color: s.accent }}>
                {b.registration}
              </div>
            )}
            <div className="mt-px truncate text-[10px] leading-[1.2] text-muted-foreground">
              {b.customerName ?? b.type}
            </div>
          </>
        )}

        {/* CSS-only tooltip */}
        <div className="booking-tooltip" style={tooltipSide}>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            {b.registration && (
              <span className="rounded-[2px] bg-[#f4d35e] px-1.5 py-px font-mono text-[10px] font-bold tracking-[0.06em] text-background">
                {b.registration}
              </span>
            )}
            <span
              className="ml-auto rounded-[2px] px-[5px] py-0.5 font-mono text-[9px] capitalize tracking-[0.06em]"
              style={{ background: s.bg, color: s.accent, border: `1px solid ${s.border}` }}
            >
              {b.status.replace(/_/g, " ")}
            </span>
          </div>
          {b.customerName && (
            <div className="mb-0.5 text-[13px] font-semibold text-foreground">{b.customerName}</div>
          )}
          <div className="mb-2 text-[11px] capitalize text-muted-foreground">{b.type.replace(/_/g, " ")}</div>
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] text-foreground">{timeRange}</span>
            <span className="font-mono text-[10px] text-muted-foreground">{durStr}</span>
          </div>
        </div>
      </Link>
    );
  }

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-[22px] py-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Day schedule · {now.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} · {padStart}–{padEnd}
          </div>
          <div className="mt-1 text-base font-semibold text-foreground">
            {bookings.length === 0
              ? "No bookings today"
              : `${bookings.length} booking${bookings.length !== 1 ? "s" : ""} · ${rows.length} row${rows.length !== 1 ? "s" : ""}`}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {bays.length === 0 && (
            <Link href="/staff/bays" className="rounded-[2px] border border-border px-3 py-1.5 font-mono text-[11px] text-muted-foreground no-underline">
              Set up bays →
            </Link>
          )}
          <Link href="/staff/bookings/new" className="rounded-[2px] border border-[#3a2c14] bg-[#1c1810] px-3 py-1.5 font-mono text-[11px] text-[#ffb020] no-underline">
            + New booking →
          </Link>
        </div>
      </div>

      {/* Schedule grid. Widths/offsets computed from the hour scale stay inline. */}
      <div className="overflow-x-auto">
        {/* Ruler */}
        <div className="flex border-b border-border" style={{ minWidth: LABEL_W + TIMELINE_W }}>
          <div
            className="sticky left-0 z-[2] shrink-0 border-r border-border bg-card px-3 py-2 font-mono text-[9px] tracking-[0.12em] text-muted-foreground"
            style={{ width: LABEL_W }}
          >
            BAY
          </div>
          <div className="relative h-[26px] shrink-0" style={{ width: TIMELINE_W }}>
            {hours.map((h) => (
              <div
                key={h}
                className="absolute top-2 -translate-x-1/2 font-mono text-[9px] text-muted-foreground"
                style={{ left: (h - DAY_START) * PX_PER_HOUR }}
              >
                {String(h).padStart(2, "0")}
              </div>
            ))}
          </div>
        </div>

        {/* Bay rows */}
        {rows.map((row, ri) => (
          <div
            key={row.id ?? "unassigned"}
            className={`flex min-h-[54px] ${ri < rows.length - 1 ? "border-b border-border" : ""}`}
            style={{ minWidth: LABEL_W + TIMELINE_W }}
          >
            <div
              className="sticky left-0 z-[1] flex shrink-0 flex-col justify-center border-r border-border bg-card px-3 py-2"
              style={{ width: LABEL_W }}
            >
              <div className="truncate font-mono text-[11px] font-semibold tracking-[0.04em] text-[#ffb020]">
                {row.name}
              </div>
              {row.sub && (
                <div className="mt-0.5 text-[10px] text-muted-foreground">{row.sub}</div>
              )}
            </div>
            <div className="relative shrink-0 py-1.5" style={{ width: TIMELINE_W }}>
              {hours.slice(1).map((h) => (
                <div
                  key={h}
                  className="absolute inset-y-0 border-l border-dashed border-border"
                  style={{ left: (h - DAY_START) * PX_PER_HOUR }}
                />
              ))}
              {showNow && (
                <div
                  className="absolute inset-y-0 z-10 border-l border-dashed border-[#ffb020]"
                  style={{ left: nowPx }}
                />
              )}
              {row.items.map((b) => renderBlock(b))}
            </div>
          </div>
        ))}

        {bookings.length === 0 && (
          <div className="w-full px-[22px] py-8 text-center font-mono text-xs text-muted-foreground">
            {"// NO BOOKINGS TODAY"}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3.5 border-t border-border px-[22px] py-3">
        {[
          { label: "Scheduled", color: "var(--muted-foreground)" },
          { label: "In progress", color: "#ffb020" },
          { label: "Complete", color: "#5fdd9d" },
          { label: "Cancelled", color: "#ff5b5b" },
        ].map((l) => (
          <div key={l.label} className="flex items-center gap-[5px]">
            <div className="h-2.5 w-2.5 rounded-[1px]" style={{ background: l.color }} />
            <span className="font-mono text-[9px] text-muted-foreground">{l.label}</span>
          </div>
        ))}
        {showNow && (
          <div className="flex items-center gap-[5px]">
            <div className="w-3.5 border-t border-dashed border-[#ffb020]" />
            <span className="font-mono text-[9px] text-muted-foreground">Now</span>
          </div>
        )}
      </div>
    </div>
  );
}

function dueDays(d: string): number {
  return Math.ceil((new Date(d).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

// Cumulative total at the end of each of the last N weeks, oldest first,
// reconstructed by walking back from today's total using the per-week added
// counts from dashboard_stats (oldest week first).
function cumulativeWeeklySeries(addedPerWeek: number[], total: number): number[] {
  const series = new Array<number>(addedPerWeek.length).fill(0);
  let running = total;
  for (let i = addedPerWeek.length - 1; i >= 0; i--) {
    series[i] = running;
    running -= addedPerWeek[i];
  }
  return series;
}

function fmtGBP(n: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(n);
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  // A single point can't make a line (and divides by zero below).
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const w = 80;
  const h = 28;
  const range = max - min || 1;
  const pts = values
    .map((v, i) => `${(i / (values.length - 1)) * w},${h - ((v - min) / range) * h}`)
    .join(" ");
  const last = values[values.length - 1];
  const lastY = h - ((last - min) / range) * h;
  return (
    <svg width={w} height={h} className="shrink-0 overflow-visible">
      <polyline fill="none" stroke={color} strokeWidth="1.5" points={pts} />
      <circle cx={w} cy={lastY} r="2.5" fill={color} />
    </svg>
  );
}

function KpiTile({
  label,
  value,
  delta,
  positive,
  sparkValues,
}: {
  label: string;
  value: string;
  delta?: string;
  positive?: boolean;
  sparkValues?: number[];
}) {
  const deltaClass =
    positive === undefined ? "text-muted-foreground" : positive ? "text-[#5fdd9d]" : "text-[#ff5b5b]";
  const sparkColor =
    positive === false ? "#ff5b5b" : positive === true ? "#5fdd9d" : "var(--muted-foreground)";
  return (
    <div className="bg-card px-5 py-[18px]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            {label}
          </div>
          <div className="mt-1.5 font-mono text-[26px] font-semibold tracking-[-0.01em] text-foreground tabular-nums">
            {value}
          </div>
          {delta && (
            <div className={`mt-0.5 font-mono text-[11px] ${deltaClass}`}>
              {delta}
            </div>
          )}
        </div>
        {sparkValues && <Sparkline values={sparkValues} color={sparkColor} />}
      </div>
    </div>
  );
}

function Plate({ reg }: { reg: string }) {
  return (
    <span className="inline-block whitespace-nowrap rounded-[3px] border border-[#c9a435] bg-[#f4d35e] px-[7px] py-0.5 font-mono text-[11px] font-bold tracking-[0.06em] text-background">
      {reg}
    </span>
  );
}

const STATUS_BADGE = {
  overdue: { className: "border-[#5a2424] bg-[#3a1a1a] text-[#ff5b5b]", label: "OVERDUE" },
  urgent: { className: "border-[#5a4218] bg-[#3a2c14] text-[#ffb020]", label: "URGENT" },
  soon: { className: "border-[#2c4458] bg-[#1f2a35] text-[#7ec8ff]", label: "SOON" },
} as const;

function StatusBadge({ status }: { status: "overdue" | "urgent" | "soon" }) {
  const s = STATUS_BADGE[status];
  return (
    <span className={`rounded-[2px] border px-1.5 py-[3px] font-mono text-[10px] tracking-[0.12em] ${s.className}`}>
      {s.label}
    </span>
  );
}

function WeeklyChart({
  days,
}: {
  days: { label: string; revenue: number; isToday: boolean; isFuture: boolean }[];
}) {
  const maxRev = Math.max(...days.map((d) => d.revenue), 1);
  const chartH = 120;
  const barW = 30;
  const gap = 10;
  const totalW = days.length * (barW + gap) - gap;
  return (
    <svg viewBox={`0 0 ${totalW} ${chartH + 28}`} className="w-full overflow-visible">
      {days.map((day, i) => {
        const barH = Math.max(day.isFuture ? 2 : (day.revenue / maxRev) * chartH, day.revenue > 0 ? 4 : 2);
        const x = i * (barW + gap);
        const y = chartH - barH;
        const fill = day.isToday ? "#f4d35e" : day.isFuture ? "var(--muted)" : "var(--border)";
        return (
          <g key={day.label}>
            {!day.isFuture && day.revenue > 0 && (
              <text
                x={x + barW / 2}
                y={y - 4}
                textAnchor="middle"
                className="fill-muted-foreground font-mono text-[8px]"
              >
                {fmtGBP(day.revenue)}
              </text>
            )}
            <rect x={x} y={y} width={barW} height={barH} fill={fill} rx={2} />
            <text
              x={x + barW / 2}
              y={chartH + 16}
              textAnchor="middle"
              className={`font-mono text-[10px] ${day.isToday ? "fill-foreground font-semibold" : "fill-muted-foreground"}`}
            >
              {day.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default async function StaffDashboard() {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  const now = new Date();
  const localDateStr = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const todayStr = localDateStr(now);

  const dayOfWeek = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const in60 = new Date(now);
  in60.setDate(in60.getDate() + 60);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const in3Days = new Date(now);
  in3Days.setDate(in3Days.getDate() + 3);

  const eightWeeksAgo = new Date(now);
  eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 8 * 7);

  const statsRes = await admin.rpc("dashboard_stats", {
    p_location_id: ctx.location.id,
    p_now: now.toISOString(),
    p_today_start: `${todayStr}T00:00:00`,
    p_today_end: `${todayStr}T23:59:59`,
    p_week_start: monday.toISOString().split("T")[0],
    p_week_end: sunday.toISOString().split("T")[0],
    p_due_cutoff: in60.toISOString().split("T")[0],
    p_quote_cutoff: in3Days.toISOString(),
    p_month_start: monthStart,
    p_eight_weeks_ago: eightWeeksAgo.toISOString(),
  });
  const stats = (statsRes.data ?? EMPTY_STATS) as DashboardStats;

  const totalCustomers = stats.total_customers;
  const totalVehicles = stats.total_vehicles;
  const remindersMonth = stats.reminders_month;
  const attentionVehicles = stats.attention_vehicles;
  const openInvoicesCount = stats.invoices_open.draft_count + stats.invoices_open.sent_count;
  const openInvoicesValue = Number(stats.invoices_open.draft_total) + Number(stats.invoices_open.sent_total);
  const activeJobs = stats.active_jobs;
  const uninvoicedJobs = stats.uninvoiced_jobs;
  const expiringQuotesCount = stats.expiring_quotes.count;
  const expiringQuotesValue = Number(stats.expiring_quotes.total);
  const todaySchedule: BookingSlot[] = stats.today_bookings.map((b) => ({
    id: b.id,
    scheduledAt: b.scheduled_at,
    durationMinutes: b.duration_minutes ?? 60,
    type: b.type,
    status: b.status,
    customerName: b.customer?.full_name ?? null,
    registration: b.vehicle?.registration ?? null,
    bayId: b.bay_id ?? null,
  }));
  const todayBookings = todaySchedule.length;
  const locationBays = stats.bays;
  const businessHoursStart: number = stats.business_hours?.start ?? 8;
  const businessHoursEnd: number = stats.business_hours?.end ?? 18;

  const revByDay = stats.week_revenue_by_day;
  const weekRevenue = Object.values(revByDay).reduce((a, b) => a + Number(b), 0);

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const dateStr = localDateStr(d);
    return {
      label: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][i],
      revenue: Number(revByDay[dateStr] ?? 0),
      isToday: dateStr === todayStr,
      isFuture: d > now,
    };
  });

  const overdue = attentionVehicles.filter((v) => {
    const m = v.mot_expiry ? dueDays(v.mot_expiry) : null;
    const s = v.service_due ? dueDays(v.service_due) : null;
    return (m !== null && m < 0) || (s !== null && s < 0);
  });
  const urgent = attentionVehicles.filter((v) => {
    const m = v.mot_expiry ? dueDays(v.mot_expiry) : null;
    const s = v.service_due ? dueDays(v.service_due) : null;
    return (
      !overdue.includes(v) &&
      ((m !== null && m >= 0 && m <= 14) || (s !== null && s >= 0 && s <= 14))
    );
  });

  const priorityItems: {
    n: string;
    title: string;
    body: string;
    impact: string;
    urgency: string;
    href: string;
  }[] = [];

  if (uninvoicedJobs > 0) {
    priorityItems.push({
      n: String(priorityItems.length + 1).padStart(2, "0"),
      title: `Invoice ${uninvoicedJobs} finished job${uninvoicedJobs !== 1 ? "s" : ""}`,
      body: "Work is done but nothing has been billed yet.",
      impact: "unbilled work",
      urgency: "now",
      href: "/staff/jobs",
    });
  }
  if (expiringQuotesCount > 0) {
    priorityItems.push({
      n: String(priorityItems.length + 1).padStart(2, "0"),
      title: `${expiringQuotesCount} quote${expiringQuotesCount !== 1 ? "s" : ""} expiring within 3 days`,
      body: "Customer hasn't responded. A nudge now beats a re-quote later.",
      impact: fmtGBP(expiringQuotesValue),
      urgency: "now",
      href: "/staff/quotes",
    });
  }
  if (overdue.length > 0) {
    priorityItems.push({
      n: String(priorityItems.length + 1).padStart(2, "0"),
      title: `Send reminders — ${overdue.length} overdue vehicle${overdue.length !== 1 ? "s" : ""}`,
      body: "MOT or service past due. Draft reminders in one click.",
      impact: `~${overdue.length * 2} bookings`,
      urgency: "now",
      href: "/staff/reminders",
    });
  }
  // Draft invoices were lumped in with sent ones under "chase unpaid" — but a
  // draft has never reached the customer; the action is "send it", not "chase it".
  const { draft_count: draftCount, sent_count: sentCount } = stats.invoices_open;
  if (draftCount > 0) {
    const value = Number(stats.invoices_open.draft_total);
    priorityItems.push({
      n: String(priorityItems.length + 1).padStart(2, "0"),
      title: `Send ${draftCount} draft invoice${draftCount !== 1 ? "s" : ""}`,
      body: `Drafted but never sent — the customer can't pay what they haven't seen.`,
      impact: fmtGBP(value),
      urgency: "today",
      href: "/staff/invoices",
    });
  }
  if (sentCount > 0) {
    const value = Number(stats.invoices_open.sent_total);
    priorityItems.push({
      n: String(priorityItems.length + 1).padStart(2, "0"),
      title: `Chase ${sentCount} unpaid invoice${sentCount !== 1 ? "s" : ""}`,
      body: `Total outstanding: ${fmtGBP(value)}. Send friendly chasers.`,
      impact: fmtGBP(value),
      urgency: "today",
      href: "/staff/invoices",
    });
  }
  if (urgent.length > 0) {
    priorityItems.push({
      n: String(priorityItems.length + 1).padStart(2, "0"),
      title: `Book ${urgent.length} vehicle${urgent.length !== 1 ? "s" : ""} due within 14 days`,
      body: "Contact before they book elsewhere.",
      impact: `+${fmtGBP(urgent.length * 120)} est`,
      urgency: "this week",
      href: "/staff/reminders",
    });
  }
  if (priorityItems.length === 0) {
    priorityItems.push({
      n: "01",
      title: "All caught up",
      body: "No urgent actions today. Review revenue or plan campaigns.",
      impact: "—",
      urgency: "today",
      href: "/staff/revenue",
    });
  }

  const h = now.getHours();
  const greeting = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  const firstName = (ctx.user.fullName ?? "").split(" ")[0] || "there";

  // Real sparkline series only — tiles with no queryable history get none.
  const revenueSpark = weekDays.filter((d) => !d.isFuture).map((d) => d.revenue);
  const customersSpark = cumulativeWeeklySeries(stats.customers_added_per_week, totalCustomers);
  const vehiclesSpark = cumulativeWeeklySeries(stats.vehicles_added_per_week, totalVehicles);
  const remindersSpark = stats.reminders_per_day;

  return (
    <div className="text-foreground">
      {/* Header */}
      <div className="mb-6">
        <h1 className="m-0 text-[26px] font-semibold leading-[1.2] tracking-[-0.02em] text-foreground">
          {greeting}, {firstName}.{" "}
          <span className="font-normal text-muted-foreground">
            {overdue.length > 0
              ? `${overdue.length} overdue — act now.`
              : "Everything looks good."}
          </span>
        </h1>
        <p className="mt-1.5 mb-0 font-mono text-xs tracking-[0.04em] text-muted-foreground">
          {todayBookings} booked today · {activeJobs} active job{activeJobs !== 1 ? "s" : ""}
          {overdue.length > 0 ? ` · ${overdue.length} MOT/service overdue` : ""}
        </p>
      </div>

      {/* 8-tile KPI grid */}
      <div className="mb-5 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border md:grid-cols-4">
        <KpiTile
          label="Revenue · week"
          value={fmtGBP(weekRevenue)}
          delta={weekRevenue > 0 ? "paid invoices" : "no paid invoices yet"}
          positive={weekRevenue > 0}
          sparkValues={revenueSpark}
        />
        <KpiTile
          label="Customers"
          value={String(totalCustomers)}
          delta="last 8 weeks"
          sparkValues={customersSpark}
        />
        <KpiTile
          label="Vehicles"
          value={String(totalVehicles)}
          delta="last 8 weeks"
          sparkValues={vehiclesSpark}
        />
        <KpiTile
          label="Overdue"
          value={String(overdue.length)}
          delta={overdue.length > 0 ? "needs attention" : "all clear"}
          positive={overdue.length === 0}
        />
        <KpiTile
          label="Active jobs"
          value={String(activeJobs)}
          delta="open status"
        />
        <KpiTile
          label="Reminders · month"
          value={String(remindersMonth)}
          delta="sent"
          positive={remindersMonth > 0}
          sparkValues={remindersSpark}
        />
        <KpiTile
          label="Open invoices"
          value={fmtGBP(openInvoicesValue)}
          delta={`${openInvoicesCount} outstanding`}
          positive={openInvoicesCount === 0}
        />
        <KpiTile
          label="Bookings · today"
          value={String(todayBookings)}
        />
      </div>

      {/* Day schedule — row 2 */}
      <TodaySchedule bookings={todaySchedule} bays={locationBays} now={now} workStart={businessHoursStart} workEnd={businessHoursEnd} />

      {/* Two-column: revenue chart + priority list */}
      <div className="my-5 grid grid-cols-1 gap-4 md:grid-cols-[1.5fr_1fr]">
        <div className="rounded-md border border-border bg-card p-[22px]">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Revenue · this week
          </div>
          <div className="mt-1 mb-5 text-lg font-semibold text-foreground">
            {fmtGBP(weekRevenue)}
            <span className="ml-2 text-[13px] font-normal text-muted-foreground">
              paid Mon–Sun
            </span>
          </div>
          <WeeklyChart days={weekDays} />
        </div>

        <div className="rounded-md border border-border bg-card p-[22px]">
          <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Priority actions
          </div>
          <div className="mb-4 text-base font-semibold text-foreground">
            Where to focus now
          </div>
          {priorityItems.map((p, i) => (
            <Link
              key={i}
              href={p.href}
              className={`grid grid-cols-[auto_1fr_auto] items-start gap-3 py-3 no-underline ${i ? "border-t border-border" : ""}`}
            >
              <span className="pt-0.5 font-mono text-[11px] text-muted-foreground">
                {p.n}
              </span>
              <div>
                <div className="text-[13px] font-semibold text-foreground">
                  {p.title}
                </div>
                <div className="mt-[3px] text-xs leading-normal text-muted-foreground">
                  {p.body}
                </div>
              </div>
              <div className="min-w-20 text-right">
                <div className="font-mono text-xs font-semibold text-[#5fdd9d]">
                  {p.impact}
                </div>
                <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                  {p.urgency}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Attention queue */}
      <div className="rounded-md border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-[22px] py-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Attention queue
            </div>
            <div className="mt-1 text-base font-semibold text-foreground">
              {overdue.length} overdue · {urgent.length} within 14d ·{" "}
              {attentionVehicles.length - overdue.length - urgent.length} upcoming
            </div>
          </div>
          <Link
            href="/staff/reminders"
            className="rounded-[2px] border border-[#3a2c14] bg-[#1c1810] px-3 py-1.5 font-mono text-[11px] text-[#ffb020] no-underline"
          >
            Send reminders →
          </Link>
        </div>

        {attentionVehicles.length === 0 ? (
          <div className="px-[22px] py-8 text-center font-mono text-xs text-muted-foreground">
            {"// NO VEHICLES DUE WITHIN 60 DAYS"}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="grid min-w-[720px] grid-cols-[130px_1fr_1fr_100px_100px_90px] border-b border-border px-[22px] py-2.5 font-mono text-[10px] tracking-[0.12em] text-muted-foreground">
              {["REG", "CUSTOMER", "VEHICLE", "MOT", "SERVICE", "STATUS"].map((col) => (
                <span key={col}>{col}</span>
              ))}
            </div>
            {attentionVehicles.map((v, i) => {
              const motDays = v.mot_expiry ? dueDays(v.mot_expiry) : null;
              const svcDays = v.service_due ? dueDays(v.service_due) : null;
              const isOverdue =
                (motDays !== null && motDays < 0) || (svcDays !== null && svcDays < 0);
              const isUrgent =
                !isOverdue &&
                ((motDays !== null && motDays <= 14) || (svcDays !== null && svcDays <= 14));
              const status: "overdue" | "urgent" | "soon" = isOverdue
                ? "overdue"
                : isUrgent
                ? "urgent"
                : "soon";
              const motLabel =
                motDays === null ? "—" : motDays < 0 ? `${Math.abs(motDays)}d ago` : `+${motDays}d`;
              const svcLabel =
                svcDays === null ? "—" : svcDays < 0 ? `${Math.abs(svcDays)}d ago` : `+${svcDays}d`;
              const dueClass = (days: number | null) =>
                days !== null && days < 0
                  ? "text-[#ff5b5b]"
                  : days !== null && days <= 14
                  ? "text-[#ffb020]"
                  : "text-muted-foreground";
              return (
                <div
                  key={v.id}
                  className={`grid min-w-[720px] grid-cols-[130px_1fr_1fr_100px_100px_90px] items-center px-[22px] py-[11px] text-[13px] ${
                    i < attentionVehicles.length - 1 ? "border-b border-border" : ""
                  }`}
                >
                  <div>
                    <Plate reg={v.registration} />
                  </div>
                  <div>
                    {v.customer ? (
                      <Link
                        href={`/staff/customers/${v.customer.id}`}
                        className="text-foreground no-underline"
                      >
                        {v.customer.full_name ?? "Unnamed"}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </div>
                  <div className="text-muted-foreground">
                    {[v.make, v.model].filter(Boolean).join(" ") || "—"}
                  </div>
                  <div className={`font-mono text-xs ${dueClass(motDays)}`}>{motLabel}</div>
                  <div className={`font-mono text-xs ${dueClass(svcDays)}`}>{svcLabel}</div>
                  <div>
                    <StatusBadge status={status} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
}
