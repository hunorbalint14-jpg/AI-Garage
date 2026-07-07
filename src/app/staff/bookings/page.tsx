import Link from "next/link";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { listLocationStaff } from "@/lib/staff-directory";
import { ShowingLatest } from "@/components/staff/showing-latest";
import { cachedBays, cachedLocationHours } from "@/lib/location-cache";
import { MicroLabel, ChipButton, Segmented } from "@/components/staff/workshop";
import { BayTimeline } from "@/components/staff/workshop/bay-timeline";
import { BookingCalendar } from "./booking-calendar";
import { AssigneeFilter } from "./assignee-filter";
import { StatusFilter } from "./status-filter";
import { type BookingRow } from "./booking-display";
import { BookingTable, type BookingListRow } from "./booking-table";
import { WeekStrip, type WeekDay } from "./week-strip";
import {
  parseMonthParam,
  buildMonthGrid,
  instantDayKey,
} from "./calendar-grid";
import {
  parseWeeklyHours,
  resolveHoursForDate,
  weekdayOfLocalDate,
  WEEKDAY_SHORT,
  APP_TZ,
  type WeeklyHours,
  type SpecialHours,
} from "@/lib/business-hours";
import type { BookingSlot } from "@/lib/dashboard";

const BOOKING_SELECT =
  "id, scheduled_at, duration_minutes, type, status, notes, assigned_to, bay_id, confirmation_sent_at, confirmed_at, reschedule_requested_at, customer:customers(id, full_name), vehicle:vehicles(registration)";

type BookingRowWithBay = BookingRow & { bay_id: string | null };

type Params = {
  view: string;
  date?: string;
  month?: string;
  filter: string;
  assignee: string;
  status: string;
};

// ONE place builds every link on this page, so view, date, month, status,
// assignee and the list filter always survive together (fixes F5 — the old
// view toggles were hardcoded hrefs that dropped active filters).
function hrefWith(current: Params, overrides: Partial<Params>): string {
  const merged = { ...current, ...overrides };
  const sp = new URLSearchParams();
  if (merged.view && merged.view !== "day") sp.set("view", merged.view);
  if (merged.date) sp.set("date", merged.date);
  if (merged.month) sp.set("month", merged.month);
  if (merged.filter && merged.filter !== "upcoming") sp.set("filter", merged.filter);
  if (merged.assignee) sp.set("assignee", merged.assignee);
  if (merged.status) sp.set("status", merged.status);
  const qs = sp.toString();
  return qs ? `/staff/bookings?${qs}` : "/staff/bookings";
}

function localDateParam(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return localDateParam(new Date(y, m - 1, d + n));
}

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; view?: string; month?: string; date?: string; assignee?: string; status?: string }>;
}) {
  const sp = await searchParams;
  // Day is the default view; "calendar" is the legacy month param value.
  const rawView = sp.view === "calendar" ? "month" : (sp.view ?? "day");
  const view = ["day", "week", "month", "list"].includes(rawView) ? rawView : "day";
  const filter = sp.filter ?? "upcoming";
  const assignee0 = sp.assignee ?? "";
  const status = sp.status ?? "";

  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  const staff = await listLocationStaff(ctx.location.id, ctx.organization.id);
  const nameMap = new Map(staff.map((s) => [s.id, s.name]));
  const assignee = assignee0 && staff.some((s) => s.id === assignee0) ? assignee0 : "";

  // Opening hours + upcoming overrides for this branch.
  const todayKey = new Date().toLocaleDateString("en-CA", { timeZone: APP_TZ });
  const hours = await cachedLocationHours(ctx.location.id, todayKey);
  const weekly = parseWeeklyHours(hours.weekly);
  const specialHours: SpecialHours[] = hours.special.map((s) => ({
    date: s.date,
    isClosed: s.is_closed,
    openMinute: s.open_minute,
    closeMinute: s.close_minute,
  }));

  const isValidDate = !!sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) && !isNaN(new Date(`${sp.date}T00:00:00`).getTime());
  const theDate = isValidDate ? sp.date! : localDateParam(new Date());

  const params: Params = { view, date: sp.date, month: sp.month, filter, assignee, status };

  // Header date title per view.
  const titleDate = new Date(`${theDate}T00:00:00`);
  const { year, month: monthIdx } = parseMonthParam(sp.month);
  const title =
    view === "month"
      ? new Date(year, monthIdx, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" })
      : view === "list"
        ? "All bookings"
        : titleDate.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

  // Date nav steps by view: day ±1, week ±7, month ±1 month.
  const navStep = view === "week" ? 7 : 1;
  const monthParam = `${year}-${String(monthIdx + 1).padStart(2, "0")}`;
  const prevHref =
    view === "month"
      ? hrefWith(params, { month: `${monthIdx === 0 ? year - 1 : year}-${String((monthIdx === 0 ? 12 : monthIdx)).padStart(2, "0")}` })
      : hrefWith(params, { date: addDays(theDate, -navStep) });
  const nextHref =
    view === "month"
      ? hrefWith(params, { month: `${monthIdx === 11 ? year + 1 : year}-${String((monthIdx === 11 ? 1 : monthIdx + 2)).padStart(2, "0")}` })
      : hrefWith(params, { date: addDays(theDate, navStep) });
  const todayHref =
    view === "month" ? hrefWith(params, { month: undefined }) : hrefWith(params, { date: undefined });

  return (
    <div className="flex flex-col gap-5">
      {/* Header row — one primary CTA on the whole page (§1d). */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <MicroLabel>Schedule · {ctx.organization.name}</MicroLabel>
          <h1 className="mt-1 text-[22px] font-semibold tracking-[-0.01em] text-ws-text">{title}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {view !== "list" && (
            <span className="inline-flex overflow-hidden rounded-[4px] border border-ws-border divide-x divide-ws-border">
              <Link href={prevHref} aria-label="Previous" className="px-2.5 py-1.5 font-mono text-[11px] text-ws-text-2 no-underline transition-colors hover:text-ws-text">‹</Link>
              <Link href={todayHref} className="bg-ws-hover px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-ws-text-2 no-underline transition-colors hover:text-ws-text">Today</Link>
              <Link href={nextHref} aria-label="Next" className="px-2.5 py-1.5 font-mono text-[11px] text-ws-text-2 no-underline transition-colors hover:text-ws-text">›</Link>
            </span>
          )}
          <Segmented
            value={view}
            items={[
              { value: "day", label: "Day", href: hrefWith(params, { view: "day" }) },
              { value: "week", label: "Week", href: hrefWith(params, { view: "week" }) },
              { value: "month", label: "Month", href: hrefWith(params, { view: "month" }) },
              { value: "list", label: "List", href: hrefWith(params, { view: "list" }) },
            ]}
          />
          <StatusFilter current={status} />
          <AssigneeFilter staff={staff} current={assignee} />
          <ChipButton variant="primary" href="/staff/bookings/new">
            + New booking
          </ChipButton>
        </div>
      </div>

      {view === "list"
        ? await renderListView({ params, locationId: ctx.location.id, admin, nameMap })
        : view === "month"
          ? await renderMonthView({ params, year, monthIdx, monthParam, locationId: ctx.location.id, admin, weekly, specialHours })
          : await renderDaySurface({ params, theDate, locationId: ctx.location.id, admin, nameMap, weekly, specialHours })}

      <p className="text-right font-mono text-[10px] text-ws-text-3">filters + view persist in the URL</p>
    </div>
  );
}

// ── Day / Week: week strip + shared bay timeline ─────────────────────────
async function renderDaySurface({
  params,
  theDate,
  locationId,
  admin,
  nameMap,
  weekly,
  specialHours,
}: {
  params: Params;
  theDate: string;
  locationId: string;
  admin: ReturnType<typeof createAdminClient>;
  nameMap: Map<string, string>;
  weekly: WeeklyHours;
  specialHours: SpecialHours[];
}) {
  const { assignee, status } = params;
  // Monday-start week containing the selected date.
  const weekStart = addDays(theDate, -((weekdayOfLocalDate(theDate) + 6) % 7));
  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const weekStartD = new Date(`${weekDates[0]}T00:00:00`);
  const weekEndD = new Date(`${addDays(weekDates[6], 1)}T00:00:00`);

  let query = admin
    .from("bookings")
    .select(BOOKING_SELECT)
    .eq("location_id", locationId)
    .gte("scheduled_at", weekStartD.toISOString())
    .lt("scheduled_at", weekEndD.toISOString());
  if (assignee) query = query.eq("assigned_to", assignee);
  if (status) query = query.eq("status", status);

  const [{ data: weekBookings }, bays] = await Promise.all([
    query.order("scheduled_at", { ascending: true }).limit(500) as unknown as Promise<{
      data: BookingRowWithBay[] | null;
    }>,
    cachedBays(locationId),
  ]);
  const all = weekBookings ?? [];

  // Per-day count + utilisation (booked minutes vs bays × open minutes).
  const todayStr = localDateParam(new Date());
  const bayCount = Math.max(1, bays.length);
  const days: WeekDay[] = weekDates.map((date) => {
    const resolved = resolveHoursForDate(weekly, specialHours, date);
    const dayBookings = all.filter((b) => instantDayKey(b.scheduled_at) === date && b.status !== "cancelled");
    const openMinutes = resolved.hours ? resolved.hours.close - resolved.hours.open : 0;
    const bookedMinutes = dayBookings.reduce((s, b) => s + (b.duration_minutes ?? 60), 0);
    return {
      date,
      weekdayShort: WEEKDAY_SHORT[weekdayOfLocalDate(date)].toUpperCase(),
      dayNum: Number(date.slice(8, 10)),
      count: dayBookings.length,
      utilisation: openMinutes > 0 ? bookedMinutes / (openMinutes * bayCount) : 0,
      open: resolved.open,
      isToday: date === todayStr,
      selected: date === theDate,
      href: hrefWith(params, { date }),
    };
  });

  const dayRows: BookingSlot[] = all
    .filter((b) => instantDayKey(b.scheduled_at) === theDate)
    .map((b) => ({
      id: b.id,
      scheduledAt: b.scheduled_at,
      durationMinutes: b.duration_minutes ?? 60,
      type: b.type,
      status: b.status,
      customerName: b.customer?.full_name ?? null,
      registration: b.vehicle?.registration ?? null,
      bayId: b.bay_id,
    }));

  const resolvedDay = resolveHoursForDate(weekly, specialHours, theDate);
  const workStart = resolvedDay.hours ? Math.floor(resolvedDay.hours.open / 60) : 8;
  const workEnd = resolvedDay.hours ? Math.ceil(resolvedDay.hours.close / 60) : 18;

  // nameMap reserved for a technician lane variant; unused today.
  void nameMap;

  return (
    <div className="flex flex-col gap-4">
      <WeekStrip days={days} />
      {resolvedDay.open ? (
        <BayTimeline
          bookings={dayRows}
          bays={bays}
          date={new Date(`${theDate}T00:00:00`)}
          now={new Date()}
          workStart={workStart}
          workEnd={workEnd}
        />
      ) : (
        <div className="rounded-md border border-ws-border bg-ws-card px-[22px] py-10 text-center font-mono text-xs text-ws-text-3">
          {"// CLOSED THIS DAY"}
        </div>
      )}
    </div>
  );
}

// ── Month ────────────────────────────────────────────────────────────────
async function renderMonthView({
  params,
  year,
  monthIdx,
  monthParam,
  locationId,
  admin,
  weekly,
  specialHours,
}: {
  params: Params;
  year: number;
  monthIdx: number;
  monthParam: string;
  locationId: string;
  admin: ReturnType<typeof createAdminClient>;
  weekly: WeeklyHours;
  specialHours: SpecialHours[];
}) {
  void params;
  const grid = buildMonthGrid(year, monthIdx);
  const gridStart = grid[0];
  const gridEnd = new Date(grid[41]);
  gridEnd.setDate(gridEnd.getDate() + 1); // exclusive upper bound

  let query = admin
    .from("bookings")
    .select(BOOKING_SELECT)
    .eq("location_id", locationId)
    .gte("scheduled_at", gridStart.toISOString())
    .lt("scheduled_at", gridEnd.toISOString());
  if (params.assignee) query = query.eq("assigned_to", params.assignee);
  if (params.status) query = query.eq("status", params.status);

  const { data } = (await query
    .order("scheduled_at", { ascending: true })
    .limit(500)) as { data: BookingRow[] | null };

  const todayKey = instantDayKey(new Date().toISOString());

  return (
    <BookingCalendar
      key={monthParam}
      bookings={data ?? []}
      monthParam={monthParam}
      todayKey={todayKey}
      weekly={weekly}
      specialHours={specialHours}
    />
  );
}

// ── List ─────────────────────────────────────────────────────────────────
async function renderListView({
  params,
  locationId,
  admin,
  nameMap,
}: {
  params: Params;
  locationId: string;
  admin: ReturnType<typeof createAdminClient>;
  nameMap: Map<string, string>;
}) {
  const { filter, assignee, status } = params;
  const now = new Date().toISOString();

  let query = admin
    .from("bookings")
    .select(BOOKING_SELECT)
    .eq("location_id", locationId);

  if (assignee) query = query.eq("assigned_to", assignee);
  if (status) query = query.eq("status", status);

  if (filter === "upcoming") {
    query = query.gte("scheduled_at", now).order("scheduled_at", { ascending: true });
  } else if (filter === "past") {
    query = query.lt("scheduled_at", now).order("scheduled_at", { ascending: false });
  } else if (filter === "today") {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    query = query
      .gte("scheduled_at", todayStart.toISOString())
      .lte("scheduled_at", todayEnd.toISOString())
      .order("scheduled_at", { ascending: true });
  } else {
    query = query.order("scheduled_at", { ascending: false });
  }

  const { data: bookings } = (await query.limit(200)) as { data: BookingRow[] | null };
  const rows: BookingListRow[] = (bookings ?? []).map((b) => ({
    ...b,
    technicianName: b.assigned_to ? (nameMap.get(b.assigned_to) ?? null) : null,
  }));

  return (
    <>
      <div className="flex gap-2">
        {[
          { key: "upcoming", label: "Upcoming" },
          { key: "today", label: "Today" },
          { key: "past", label: "Past" },
          { key: "all", label: "All" },
        ].map((f) => (
          <Link
            key={f.key}
            href={hrefWith(params, { filter: f.key })}
            className={`rounded-[3px] px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] no-underline transition-colors ${
              filter === f.key ? "bg-ws-amber-bg text-ws-amber" : "text-ws-text-2 hover:text-ws-text"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-ws-border p-12 text-center">
          <p className="font-mono text-xs text-ws-text-3">{"// NO BOOKINGS TO SHOW"}</p>
        </div>
      ) : (
        <>
          <BookingTable rows={rows} />
          {rows.length >= 200 && <ShowingLatest limit={200} entity="bookings for this filter" />}
        </>
      )}
    </>
  );
}
