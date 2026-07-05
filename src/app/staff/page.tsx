import { Suspense } from "react";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { CardGridSkeleton, BlockSkeleton, TableSkeleton } from "@/components/staff/skeletons";
import { KpiTile } from "@/components/staff/dashboard/kpi-tile";
import { TodaySchedule } from "@/components/staff/dashboard/today-schedule";
import { WeeklyChart } from "@/components/staff/dashboard/weekly-chart";
import { AttentionQueue } from "@/components/staff/dashboard/attention-queue";
import { PriorityActions } from "@/components/staff/dashboard/priority-actions";
import {
  EMPTY_STATS,
  buildPriorityItems,
  classifyAttention,
  cumulativeWeeklySeries,
  fmtGBP,
  type BookingSlot,
  type DashboardStats,
} from "@/lib/dashboard";

export const dynamic = "force-dynamic";

// Dashboard-shaped fallback (header line + 8-tile KPI grid + schedule block +
// attention table) so the streamed render swaps in without a layout jump.
function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <div className="mb-1 h-7 w-80 max-w-[70%] animate-pulse rounded bg-white/[0.06]" />
      <CardGridSkeleton count={8} className="grid-cols-1 gap-px min-[400px]:grid-cols-2 md:grid-cols-4" />
      <BlockSkeleton className="h-64" />
      <TableSkeleton rows={6} cols={6} />
    </div>
  );
}

export default async function StaffDashboard() {
  if (!(await isFeatureEnabled("streaming_dashboard"))) return <DashboardContent />;
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardContent />
    </Suspense>
  );
}

async function DashboardContent() {
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

  const { overdue, urgent } = classifyAttention(attentionVehicles);

  const priorityItems = buildPriorityItems({
    uninvoicedJobs: stats.uninvoiced_jobs,
    expiringQuotes: stats.expiring_quotes,
    invoicesOpen: stats.invoices_open,
    overdueCount: overdue.length,
    urgentCount: urgent.length,
  });

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

      {/* 8-tile KPI grid — single column under 400px, where the 2-col layout
          wraps the mono captions ("REVENUE · WEEK") mid-word. */}
      <div className="mb-5 grid grid-cols-1 gap-px overflow-hidden rounded-md border border-border bg-border min-[400px]:grid-cols-2 md:grid-cols-4">
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

        <PriorityActions items={priorityItems} />
      </div>

      {/* Attention queue */}
      <AttentionQueue
        vehicles={attentionVehicles}
        overdueCount={overdue.length}
        urgentCount={urgent.length}
      />
    </div>
  );
}
