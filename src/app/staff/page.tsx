import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { hasPermission } from "@/lib/permissions";
import { utilisationSummary, workingDaysBetween } from "@/lib/reports";
import { CardGridSkeleton, BlockSkeleton, TableSkeleton } from "@/components/staff/skeletons";
import { KpiTile } from "@/components/staff/dashboard/kpi-tile";
import { csatSummary } from "@/lib/csat";
import { BayTimeline } from "@/components/staff/workshop/bay-timeline";
import { WeeklyChart } from "@/components/staff/dashboard/weekly-chart";
import { AttentionQueue } from "@/components/staff/dashboard/attention-queue";
import { PriorityActions } from "@/components/staff/dashboard/priority-actions";
import { MyDay } from "@/components/staff/dashboard/my-day";
import {
  EMPTY_STATS_V2,
  anyWidgetVisible,
  buildPriorityItems,
  classifyAttention,
  cumulativeWeeklySeries,
  dashboardWidgets,
  fmtGBP,
  type BookingSlot,
  type DashboardStatsV2,
} from "@/lib/dashboard";

export const dynamic = "force-dynamic";

// Dashboard-shaped fallback (header line + 8-tile KPI grid + schedule block +
// attention table) so the streamed render swaps in without a layout jump. The
// tile count is a generic shape — per-role counts vary but the swap is brief.
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

  const can = (key: Parameters<typeof hasPermission>[1]) => hasPermission(ctx, key);
  const widgets = dashboardWidgets(ctx.orgRole, can);

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

  const statsRes = await admin.rpc("dashboard_stats_v2", {
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
    // Server-derived only — the RPC trusts these (service-role, no RLS).
    p_user_id: ctx.user.id,
    p_include_finance: widgets.revenue,
    p_include_owner: widgets.ownerRow,
  });
  const stats = (statsRes.data ?? EMPTY_STATS_V2) as DashboardStatsV2;

  // Post-service pulse (#508): rolling 90-day CSAT + response rate.
  let pulse: ReturnType<typeof csatSummary> | null = null;
  if (widgets.growth) {
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 86_400_000).toISOString();
    const { data: pulseRows } = await admin
      .from("review_requests")
      .select("status, score")
      .eq("location_id", ctx.location.id)
      .gte("created_at", ninetyDaysAgo)
      .limit(1000);
    pulse = csatSummary((pulseRows ?? []) as { status: string; score: number | null }[]);
  }

  // Deferred-work pipeline (#498): open £ + recovered £ this month. Two thin
  // queries rather than an RPC change — the table is small per location.
  let deferredOpen = 0;
  let deferredRecovered = 0;
  if (widgets.revenue) {
    const [{ data: dOpen }, { data: dRec }] = await Promise.all([
      admin.from("deferred_work").select("price").eq("location_id", ctx.location.id).eq("status", "open"),
      admin
        .from("deferred_work")
        .select("price")
        .eq("location_id", ctx.location.id)
        .eq("status", "recovered")
        .gte("recovered_at", monthStart),
    ]);
    const sum = (list: unknown) => ((list ?? []) as { price: number | null }[]).reduce((s, r) => s + (r.price ?? 0), 0);
    deferredOpen = sum(dOpen);
    deferredRecovered = sum(dRec);
  }

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

  const priorityItems = buildPriorityItems(
    {
      uninvoicedJobs: stats.uninvoiced_jobs,
      expiringQuotes: stats.expiring_quotes,
      invoicesOpen: stats.invoices_open,
      overdueCount: overdue.length,
      urgentCount: urgent.length,
    },
    {
      invoices: widgets.invoices,
      quotesSend: can("quotes_send"),
      reminders: widgets.reminders,
      revenue: widgets.revenue,
    },
  );

  const h = now.getHours();
  const greeting = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  const firstName = (ctx.user.fullName ?? "").split(" ")[0] || "there";

  // Real sparkline series only — tiles with no queryable history get none.
  const revenueSpark = weekDays.filter((d) => !d.isFuture).map((d) => d.revenue);
  const customersSpark = cumulativeWeeklySeries(stats.customers_added_per_week, totalCustomers);
  const vehiclesSpark = cumulativeWeeklySeries(stats.vehicles_added_per_week, totalVehicles);
  const remindersSpark = stats.reminders_per_day;

  // Owner row derived figures.
  const avgInvoice =
    stats.finance && stats.finance.paid_count > 0
      ? Number(stats.finance.total_paid) / stats.finance.paid_count
      : null;
  // Utilisation estimate: worked minutes vs flat business-hours capacity for
  // the week so far. /staff/reports computes the per-day-hours-accurate figure.
  const utilisation =
    widgets.utilisation && stats.week_worked && stats.week_worked.techs > 0
      ? utilisationSummary({
          workedMinutes: stats.week_worked.minutes,
          labourLines: [],
          techCount: stats.week_worked.techs,
          hoursPerDay: Math.max(businessHoursEnd - businessHoursStart, 0),
          workingDays: workingDaysBetween(monday, now),
        }).utilisationPct
      : null;

  // KPI grid, role-composed. Order: money first (when visible), then ops.
  const tiles: ReactNode[] = [];
  if (widgets.revenue) {
    tiles.push(
      <KpiTile
        key="revenue"
        label="Revenue · week"
        value={fmtGBP(weekRevenue)}
        delta={weekRevenue > 0 ? "paid invoices" : "no paid invoices yet"}
        positive={weekRevenue > 0}
        sparkValues={revenueSpark}
      />,
    );
    tiles.push(
      <KpiTile
        key="wip"
        label="WIP · open jobs"
        value={fmtGBP(Number(stats.wip?.total ?? 0))}
        delta={`${stats.wip?.job_count ?? 0} job${(stats.wip?.job_count ?? 0) !== 1 ? "s" : ""} in progress`}
      />,
    );
    tiles.push(
      <KpiTile
        key="deferred"
        label="Deferred work"
        value={fmtGBP(deferredOpen)}
        delta={deferredRecovered > 0 ? `${fmtGBP(deferredRecovered)} recovered this month` : "none recovered yet this month"}
        positive={deferredRecovered > 0 ? true : undefined}
      />,
    );
  }
  if (widgets.growth) {
    tiles.push(
      <KpiTile key="customers" label="Customers" value={String(totalCustomers)} delta="last 8 weeks" sparkValues={customersSpark} />,
      <KpiTile key="vehicles" label="Vehicles" value={String(totalVehicles)} delta="last 8 weeks" sparkValues={vehiclesSpark} />,
    );
    if (pulse && pulse.delivered > 0) {
      tiles.push(
        <KpiTile
          key="csat"
          label="CSAT · 90d"
          value={pulse.avgScore !== null ? `${pulse.avgScore}★` : "—"}
          delta={
            pulse.responded > 0
              ? `${pulse.responseRatePct}% replied · ${pulse.lowScores} unhappy intercepted`
              : `${pulse.delivered} pulse${pulse.delivered === 1 ? "" : "s"} sent · no replies yet`
          }
          positive={pulse.lowScores === 0 ? undefined : false}
        />,
      );
    }
  }
  if (widgets.reminders) {
    tiles.push(
      <KpiTile
        key="overdue"
        label="Overdue"
        value={String(overdue.length)}
        delta={overdue.length > 0 ? "needs attention" : "all clear"}
        positive={overdue.length === 0}
      />,
    );
  }
  if (widgets.bookingsOps) {
    tiles.push(
      <KpiTile key="active-jobs" label="Active jobs" value={String(activeJobs)} delta="open status" />,
      <KpiTile key="bookings-today" label="Bookings · today" value={String(todayBookings)} />,
      <KpiTile
        key="courtesy"
        label="Courtesy cars out"
        value={String(stats.courtesy.out_count)}
        delta={
          stats.courtesy.overdue_count > 0
            ? `${stats.courtesy.overdue_count} overdue return${stats.courtesy.overdue_count !== 1 ? "s" : ""}`
            : "none overdue"
        }
        positive={stats.courtesy.overdue_count === 0 ? undefined : false}
      />,
      <KpiTile
        key="no-shows"
        label="No-shows · today"
        value={String(stats.no_show_today)}
        delta={stats.no_show_today > 0 ? "follow up" : "all attended"}
        positive={stats.no_show_today === 0 ? undefined : false}
      />,
    );
  }
  if (widgets.quotesPending) {
    tiles.push(
      <KpiTile
        key="quotes-pending"
        label="Quotes awaiting"
        value={String(stats.quotes_pending.count)}
        delta={stats.quotes_pending.count > 0 ? `${fmtGBP(Number(stats.quotes_pending.total))} pending` : "none open"}
      />,
    );
  }
  if (widgets.lowStock) {
    tiles.push(
      <KpiTile
        key="low-stock"
        label="Low stock"
        value={String(stats.low_stock)}
        delta="active products"
        positive={stats.low_stock === 0 ? undefined : false}
      />,
    );
  }
  if (widgets.reminders) {
    tiles.push(
      <KpiTile
        key="reminders"
        label="Reminders · month"
        value={String(remindersMonth)}
        delta="sent"
        positive={remindersMonth > 0}
        sparkValues={remindersSpark}
      />,
    );
  }
  if (widgets.invoices) {
    tiles.push(
      <KpiTile
        key="open-invoices"
        label="Open invoices"
        value={fmtGBP(openInvoicesValue)}
        delta={`${openInvoicesCount} outstanding`}
        positive={openInvoicesCount === 0}
      />,
    );
  }
  // Pad the last md row so the bordered grid doesn't show a bare patch.
  const fillers = (4 - (tiles.length % 4)) % 4;

  // My day renders only when the user actually has work: their own
  // assignments, no permission gate.
  const myDay = stats.my_day;
  const showMyDay =
    myDay !== null &&
    (myDay.bookings.length > 0 || myDay.jobs.length > 0 || myDay.open_entry !== null);

  const showEmptyHint = !anyWidgetVisible(widgets) && !showMyDay;

  return (
    <div className="text-foreground">
      {/* Header */}
      <div className="mb-6">
        <h1 className="m-0 text-[26px] font-semibold leading-[1.2] tracking-[-0.02em] text-foreground">
          {greeting}, {firstName}.{" "}
          <span className="font-normal text-muted-foreground">
            {widgets.reminders && overdue.length > 0
              ? `${overdue.length} overdue — act now.`
              : "Everything looks good."}
          </span>
        </h1>
        {widgets.bookingsOps && (
          <p className="mt-1.5 mb-0 font-mono text-xs tracking-[0.04em] text-muted-foreground">
            {todayBookings} booked today · {activeJobs} active job{activeJobs !== 1 ? "s" : ""}
            {widgets.reminders && overdue.length > 0 ? ` · ${overdue.length} MOT/service overdue` : ""}
          </p>
        )}
      </div>

      {showEmptyHint && (
        <div className="rounded-md border border-border bg-card px-[22px] py-8 text-center font-mono text-xs text-muted-foreground">
          {"// NO DASHBOARD MODULES ARE ENABLED FOR YOUR ROLE"}
        </div>
      )}

      {/* The user's own day comes before the org-wide widgets. */}
      {showMyDay && myDay && <MyDay data={myDay} now={now} />}

      {/* KPI grid — single column under 400px, where the 2-col layout wraps
          the mono captions ("REVENUE · WEEK") mid-word. */}
      {tiles.length > 0 && (
        <div className="mb-5 grid grid-cols-1 gap-px overflow-hidden rounded-md border border-border bg-border min-[400px]:grid-cols-2 md:grid-cols-4">
          {tiles}
          {Array.from({ length: fillers }, (_, i) => (
            <div key={`filler-${i}`} className="hidden bg-card min-[400px]:block" />
          ))}
        </div>
      )}

      {/* Owner/finance summary row — deep-links to the authoritative pages. */}
      {widgets.ownerRow && stats.finance && (
        <div className="mb-5 grid grid-cols-1 gap-px overflow-hidden rounded-md border border-border bg-border min-[400px]:grid-cols-2 md:grid-cols-4">
          <Link href="/staff/revenue" className="no-underline">
            <KpiTile
              label="Revenue · month"
              value={fmtGBP(Number(stats.finance.revenue_month))}
              delta="paid this month →"
              positive={Number(stats.finance.revenue_month) > 0}
            />
          </Link>
          <Link href="/staff/revenue" className="no-underline">
            <KpiTile
              label="Avg invoice"
              value={avgInvoice !== null ? fmtGBP(avgInvoice) : "—"}
              delta="all-time paid →"
            />
          </Link>
          <Link href="/staff/reports" className="no-underline">
            <KpiTile
              label="Aged debtors"
              value={fmtGBP(Number(stats.finance.aged_overdue))}
              delta="past due →"
              positive={Number(stats.finance.aged_overdue) === 0}
            />
          </Link>
          {widgets.utilisation ? (
            <Link href="/staff/reports" className="no-underline">
              <KpiTile
                label="Utilisation · week"
                value={utilisation !== null ? `${utilisation}%` : "—"}
                delta="est, clocked vs capacity →"
              />
            </Link>
          ) : (
            <div className="hidden bg-card min-[400px]:block" />
          )}
        </div>
      )}

      {/* Day schedule */}
      {widgets.bookingsOps && (
        <BayTimeline
          bookings={todaySchedule}
          bays={locationBays}
          date={now.toISOString()}
          now={now.toISOString()}
          interactive
          workStart={businessHoursStart}
          workEnd={businessHoursEnd}
          headerActions={
            <>
              {locationBays.length === 0 && (
                <Link href="/staff/bays" className="rounded-[2px] border border-border px-3 py-1.5 font-mono text-[11px] text-muted-foreground no-underline">
                  Set up bays →
                </Link>
              )}
              <Link href="/staff/bookings/new" className="rounded-[2px] border border-[#3a2c14] bg-[#1c1810] px-3 py-1.5 font-mono text-[11px] text-[#ffb020] no-underline">
                + New booking →
              </Link>
            </>
          }
        />
      )}

      {/* Two-column: revenue chart + priority list (either drops out when hidden/empty) */}
      {(widgets.revenue || !showEmptyHint) && (
        <div className={`grid grid-cols-1 gap-4 ${widgets.bookingsOps ? "my-5" : "mb-5"} ${widgets.revenue ? "md:grid-cols-[1.5fr_1fr]" : ""}`}>
          {widgets.revenue && (
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
          )}

          <PriorityActions items={priorityItems} />
        </div>
      )}

      {/* Attention queue */}
      {widgets.reminders && (
        <AttentionQueue
          vehicles={attentionVehicles}
          overdueCount={overdue.length}
          urgentCount={urgent.length}
        />
      )}
    </div>
  );
}
