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

const BOOKING_STATUS: Record<string, { bg: string; border: string; accent: string }> = {
  scheduled:   { bg: "#1c2026", border: "#383e48", accent: "#9aa1ad" },
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
  const mono = "var(--font-geist-mono, monospace)";
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
        className="booking-block"
        style={{
          position: "absolute",
          left: leftPx,
          width: widthPx,
          top: 6,
          bottom: 6,
          background: s.bg,
          border: `1px solid ${s.border}`,
          borderLeft: `3px solid ${s.accent}`,
          borderRadius: 2,
          padding: isNarrow ? 0 : "4px 6px",
          overflow: "visible",
          boxSizing: "border-box" as const,
        }}
      >
        {!isNarrow && (
          <>
            {b.registration && (
              <div style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, color: s.accent, letterSpacing: "0.04em", lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {b.registration}
              </div>
            )}
            <div style={{ fontSize: 10, color: "#9aa1ad", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.2 }}>
              {b.customerName ?? b.type}
            </div>
          </>
        )}

        {/* CSS-only tooltip */}
        <div className="booking-tooltip" style={tooltipSide}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 6 }}>
            {b.registration && (
              <span style={{ fontFamily: mono, fontWeight: 700, letterSpacing: "0.06em", background: "#f4d35e", color: "#0e1014", padding: "1px 6px", borderRadius: 2, fontSize: 10 }}>
                {b.registration}
              </span>
            )}
            <span style={{ fontFamily: mono, fontSize: 9, padding: "2px 5px", borderRadius: 2, background: s.bg, color: s.accent, border: `1px solid ${s.border}`, marginLeft: "auto", textTransform: "capitalize", letterSpacing: "0.06em" }}>
              {b.status.replace(/_/g, " ")}
            </span>
          </div>
          {b.customerName && (
            <div style={{ fontSize: 13, fontWeight: 600, color: "#e6e8eb", marginBottom: 2 }}>{b.customerName}</div>
          )}
          <div style={{ fontSize: 11, color: "#9aa1ad", textTransform: "capitalize", marginBottom: 8 }}>{b.type.replace(/_/g, " ")}</div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontFamily: mono, fontSize: 10, color: "#e6e8eb" }}>{timeRange}</span>
            <span style={{ fontFamily: mono, fontSize: 10, color: "#5a6170" }}>{durStr}</span>
          </div>
        </div>
      </Link>
    );
  }

  return (
    <div style={{ background: "#15181d", border: "1px solid #2a2f37", borderRadius: 6 }}>
      <div style={{ padding: "16px 22px", borderBottom: "1px solid #2a2f37", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 10, color: "#5a6170", fontFamily: mono, letterSpacing: "0.12em", textTransform: "uppercase" }}>
            Day schedule · {now.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} · {padStart}–{padEnd}
          </div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "#e6e8eb", marginTop: 4 }}>
            {bookings.length === 0
              ? "No bookings today"
              : `${bookings.length} booking${bookings.length !== 1 ? "s" : ""} · ${rows.length} row${rows.length !== 1 ? "s" : ""}`}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {bays.length === 0 && (
            <Link href="/staff/bays" style={{ fontFamily: mono, fontSize: 11, color: "#9aa1ad", textDecoration: "none", padding: "6px 12px", border: "1px solid #2a2f37", borderRadius: 2 }}>
              Set up bays →
            </Link>
          )}
          <Link href="/staff/bookings/new" style={{ fontFamily: mono, fontSize: 11, color: "#ffb020", textDecoration: "none", padding: "6px 12px", border: "1px solid #3a2c14", borderRadius: 2, background: "#1c1810" }}>
            + New booking →
          </Link>
        </div>
      </div>

      {/* Schedule grid */}
      <div style={{ overflowX: "auto" }}>
        {/* Ruler */}
        <div style={{ display: "flex", borderBottom: "1px solid #2a2f37", minWidth: LABEL_W + TIMELINE_W }}>
          <div style={{ width: LABEL_W, flexShrink: 0, padding: "8px 12px", fontFamily: mono, fontSize: 9, color: "#5a6170", letterSpacing: "0.12em", position: "sticky", left: 0, background: "#15181d", zIndex: 2, borderRight: "1px solid #2a2f37" }}>BAY</div>
          <div style={{ position: "relative", width: TIMELINE_W, flexShrink: 0, height: 26 }}>
            {hours.map((h) => (
              <div key={h} style={{ position: "absolute", left: (h - DAY_START) * PX_PER_HOUR, top: 8, transform: "translateX(-50%)", fontFamily: mono, fontSize: 9, color: "#5a6170" }}>
                {String(h).padStart(2, "0")}
              </div>
            ))}
          </div>
        </div>

        {/* Bay rows */}
        {rows.map((row, ri) => (
          <div
            key={row.id ?? "unassigned"}
            style={{
              display: "flex",
              borderBottom: ri < rows.length - 1 ? "1px solid #2a2f37" : "none",
              minHeight: 54,
              minWidth: LABEL_W + TIMELINE_W,
            }}
          >
            <div style={{ width: LABEL_W, flexShrink: 0, padding: "8px 12px", borderRight: "1px solid #2a2f37", display: "flex", flexDirection: "column", justifyContent: "center", position: "sticky", left: 0, background: "#15181d", zIndex: 1 }}>
              <div style={{ fontFamily: mono, fontSize: 11, color: "#ffb020", fontWeight: 600, letterSpacing: "0.04em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {row.name}
              </div>
              {row.sub && (
                <div style={{ fontSize: 10, color: "#5a6170", marginTop: 2 }}>{row.sub}</div>
              )}
            </div>
            <div style={{ position: "relative", width: TIMELINE_W, flexShrink: 0, padding: "6px 0" }}>
              {hours.slice(1).map((h) => (
                <div key={h} style={{ position: "absolute", left: (h - DAY_START) * PX_PER_HOUR, top: 0, bottom: 0, borderLeft: "1px dashed #2a2f37" }} />
              ))}
              {showNow && (
                <div style={{ position: "absolute", left: nowPx, top: 0, bottom: 0, borderLeft: "1px dashed #ffb020", zIndex: 10 }} />
              )}
              {row.items.map((b) => renderBlock(b))}
            </div>
          </div>
        ))}

        {bookings.length === 0 && (
          <div style={{ width: "100%", padding: "32px 22px", textAlign: "center", color: "#5a6170", fontFamily: mono, fontSize: 12 }}>
            // NO BOOKINGS TODAY
          </div>
        )}
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: 14, padding: "12px 22px", flexWrap: "wrap", borderTop: "1px solid #2a2f37" }}>
        {[
          { label: "Scheduled", color: "#9aa1ad" },
          { label: "In progress", color: "#ffb020" },
          { label: "Complete", color: "#5fdd9d" },
          { label: "Cancelled", color: "#ff5b5b" },
        ].map((l) => (
          <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{ width: 10, height: 10, background: l.color, borderRadius: 1 }} />
            <span style={{ fontFamily: mono, fontSize: 9, color: "#5a6170" }}>{l.label}</span>
          </div>
        ))}
        {showNow && (
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{ width: 14, borderTop: "1px dashed #ffb020" }} />
            <span style={{ fontFamily: mono, fontSize: 9, color: "#5a6170" }}>Now</span>
          </div>
        )}
      </div>
    </div>
  );
}

function dueDays(d: string): number {
  return Math.ceil((new Date(d).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function fmtGBP(n: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(n);
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
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
    <svg width={w} height={h} style={{ overflow: "visible", flexShrink: 0 }}>
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
  const deltaColor =
    positive === undefined ? "#9aa1ad" : positive ? "#5fdd9d" : "#ff5b5b";
  const sparkColor =
    positive === false ? "#ff5b5b" : positive === true ? "#5fdd9d" : "#9aa1ad";
  return (
    <div style={{ background: "#15181d", padding: "18px 20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 10,
              color: "#5a6170",
              fontFamily: "var(--font-geist-mono, monospace)",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            {label}
          </div>
          <div
            style={{
              fontFamily: "var(--font-geist-mono, monospace)",
              fontSize: 26,
              marginTop: 6,
              letterSpacing: "-0.01em",
              fontWeight: 600,
              color: "#e6e8eb",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {value}
          </div>
          {delta && (
            <div
              style={{
                fontFamily: "var(--font-geist-mono, monospace)",
                fontSize: 11,
                color: deltaColor,
                marginTop: 2,
              }}
            >
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
    <span
      style={{
        fontFamily: "var(--font-geist-mono, monospace)",
        fontWeight: 700,
        letterSpacing: "0.06em",
        background: "#f4d35e",
        color: "#0e1014",
        padding: "2px 7px",
        borderRadius: 3,
        fontSize: 11,
        border: "1px solid #c9a435",
        whiteSpace: "nowrap",
        display: "inline-block",
      }}
    >
      {reg}
    </span>
  );
}

function StatusBadge({ status }: { status: "overdue" | "urgent" | "soon" }) {
  const s = {
    overdue: { bg: "#3a1a1a", color: "#ff5b5b", border: "#5a2424", label: "OVERDUE" },
    urgent: { bg: "#3a2c14", color: "#ffb020", border: "#5a4218", label: "URGENT" },
    soon: { bg: "#1f2a35", color: "#7ec8ff", border: "#2c4458", label: "SOON" },
  }[status];
  return (
    <span
      style={{
        fontFamily: "var(--font-geist-mono, monospace)",
        fontSize: 10,
        letterSpacing: "0.12em",
        padding: "3px 6px",
        borderRadius: 2,
        background: s.bg,
        color: s.color,
        border: `1px solid ${s.border}`,
      }}
    >
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
    <svg
      viewBox={`0 0 ${totalW} ${chartH + 28}`}
      style={{ width: "100%", overflow: "visible" }}
    >
      {days.map((day, i) => {
        const barH = Math.max(day.isFuture ? 2 : (day.revenue / maxRev) * chartH, day.revenue > 0 ? 4 : 2);
        const x = i * (barW + gap);
        const y = chartH - barH;
        const fill = day.isToday ? "#f4d35e" : day.isFuture ? "#1c2026" : "#383e48";
        return (
          <g key={day.label}>
            {!day.isFuture && day.revenue > 0 && (
              <text
                x={x + barW / 2}
                y={y - 4}
                textAnchor="middle"
                style={{
                  fontFamily: "var(--font-geist-mono, monospace)",
                  fontSize: 8,
                  fill: "#5a6170",
                }}
              >
                {fmtGBP(day.revenue)}
              </text>
            )}
            <rect x={x} y={y} width={barW} height={barH} fill={fill} rx={2} />
            <text
              x={x + barW / 2}
              y={chartH + 16}
              textAnchor="middle"
              style={{
                fontFamily: "var(--font-geist-mono, monospace)",
                fontSize: 10,
                fill: day.isToday ? "#e6e8eb" : "#5a6170",
                fontWeight: day.isToday ? "600" : "400",
              }}
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
  const todayStr = now.toISOString().split("T")[0];

  const dayOfWeek = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const in60 = new Date(now);
  in60.setDate(in60.getDate() + 60);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const [
    customersRes,
    vehiclesRes,
    remindersMonthRes,
    attentionRes,
    openInvoicesRes,
    activeJobsRes,
    todayBookingsRes,
    weekPaidRes,
    baysRes,
    locationHoursRes,
  ] = await Promise.all([
    admin
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("location_id", ctx.location.id),
    admin
      .from("vehicles")
      .select("id", { count: "exact", head: true })
      .eq("location_id", ctx.location.id),
    admin
      .from("reminders")
      .select("id", { count: "exact", head: true })
      .eq("location_id", ctx.location.id)
      .gte("sent_at", monthStart),
    admin
      .from("vehicles")
      .select("id, registration, make, model, mot_expiry, service_due, customer:customers(id, full_name)")
      .eq("location_id", ctx.location.id)
      .or(
        `mot_expiry.lte.${in60.toISOString().split("T")[0]},service_due.lte.${in60.toISOString().split("T")[0]}`,
      )
      .order("mot_expiry", { ascending: true })
      .limit(20),
    admin
      .from("invoices")
      .select("id, total")
      .eq("location_id", ctx.location.id)
      .in("status", ["draft", "sent"]),
    admin
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("location_id", ctx.location.id)
      .eq("status", "open"),
    admin
      .from("bookings")
      .select("id, scheduled_at, duration_minutes, type, status, bay_id, customer:customers(id, full_name), vehicle:vehicles(registration)")
      .eq("location_id", ctx.location.id)
      .gte("scheduled_at", `${todayStr}T00:00:00`)
      .lte("scheduled_at", `${todayStr}T23:59:59`)
      .order("scheduled_at", { ascending: true }),
    admin
      .from("invoices")
      .select("total, issued_at")
      .eq("location_id", ctx.location.id)
      .eq("status", "paid")
      .gte("issued_at", monday.toISOString().split("T")[0])
      .lte("issued_at", sunday.toISOString().split("T")[0]),
    admin
      .from("bays")
      .select("id, name, description")
      .eq("location_id", ctx.location.id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    admin
      .from("locations")
      .select("business_hours_start, business_hours_end")
      .eq("id", ctx.location.id)
      .single(),
  ]);

  const totalCustomers = customersRes.count ?? 0;
  const totalVehicles = vehiclesRes.count ?? 0;
  const remindersMonth = remindersMonthRes.count ?? 0;
  const attentionVehicles = (attentionRes.data ?? []) as unknown as Vehicle[];
  const openInvoices = openInvoicesRes.data ?? [];
  const openInvoicesValue = openInvoices.reduce((sum, inv) => sum + Number(inv.total), 0);
  const activeJobs = activeJobsRes.count ?? 0;
  type BookingRow = {
    id: string;
    scheduled_at: string;
    duration_minutes: number | null;
    type: string;
    status: string;
    bay_id: string | null;
    customer: { id: string; full_name: string | null } | null;
    vehicle: { registration: string } | null;
  };
  const todaySchedule: BookingSlot[] = (
    (todayBookingsRes.data ?? []) as unknown as BookingRow[]
  ).map((b) => ({
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
  const locationBays = (baysRes.data ?? []) as BayRow[];
  const businessHoursStart: number = (locationHoursRes.data as { business_hours_start?: number } | null)?.business_hours_start ?? 8;
  const businessHoursEnd: number = (locationHoursRes.data as { business_hours_end?: number } | null)?.business_hours_end ?? 18;
  const weekPaid = weekPaidRes.data ?? [];

  const revByDay: Record<string, number> = {};
  for (const inv of weekPaid) {
    const dateKey = (inv.issued_at as string).split("T")[0];
    revByDay[dateKey] = (revByDay[dateKey] ?? 0) + Number(inv.total);
  }
  const weekRevenue = Object.values(revByDay).reduce((a, b) => a + b, 0);

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const dateStr = d.toISOString().split("T")[0];
    return {
      label: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][i],
      revenue: revByDay[dateStr] ?? 0,
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
  if (openInvoices.length > 0) {
    priorityItems.push({
      n: String(priorityItems.length + 1).padStart(2, "0"),
      title: `Chase ${openInvoices.length} unpaid invoice${openInvoices.length !== 1 ? "s" : ""}`,
      body: `Total outstanding: ${fmtGBP(openInvoicesValue)}. Send friendly chasers.`,
      impact: fmtGBP(openInvoicesValue),
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

  const growSpark = (v: number) =>
    [0.6, 0.65, 0.7, 0.75, 0.82, 0.88, 0.93, 1].map((x) => x * Math.max(v, 1));
  const flatSpark = (v: number) =>
    [1, 0.9, 1.05, 0.95, 1.1, 1.0, 0.95, 1].map((x) => x * Math.max(v, 1));

  return (
    <div style={{ color: "#e6e8eb" }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1
          style={{
            fontSize: 26,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            margin: 0,
            color: "#e6e8eb",
            lineHeight: 1.2,
          }}
        >
          {greeting}, {firstName}.{" "}
          <span style={{ color: "#5a6170", fontWeight: 400 }}>
            {overdue.length > 0
              ? `${overdue.length} overdue — act now.`
              : "Everything looks good."}
          </span>
        </h1>
        <p
          style={{
            fontSize: 12,
            color: "#9aa1ad",
            margin: "6px 0 0",
            fontFamily: "var(--font-geist-mono, monospace)",
            letterSpacing: "0.04em",
          }}
        >
          {todayBookings} booked today · {activeJobs} active job{activeJobs !== 1 ? "s" : ""}
          {overdue.length > 0 ? ` · ${overdue.length} MOT/service overdue` : ""}
        </p>
      </div>

      {/* 8-tile KPI grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 1,
          background: "#2a2f37",
          border: "1px solid #2a2f37",
          borderRadius: 6,
          overflow: "hidden",
          marginBottom: 20,
        }}
      >
        <KpiTile
          label="Revenue · week"
          value={fmtGBP(weekRevenue)}
          delta={weekRevenue > 0 ? "paid invoices" : "no paid invoices yet"}
          positive={weekRevenue > 0}
          sparkValues={growSpark(Math.max(weekRevenue, 500))}
        />
        <KpiTile
          label="Customers"
          value={String(totalCustomers)}
          sparkValues={growSpark(Math.max(totalCustomers, 10))}
        />
        <KpiTile
          label="Vehicles"
          value={String(totalVehicles)}
          sparkValues={growSpark(Math.max(totalVehicles, 10))}
        />
        <KpiTile
          label="Overdue"
          value={String(overdue.length)}
          delta={overdue.length > 0 ? "needs attention" : "all clear"}
          positive={overdue.length === 0}
          sparkValues={flatSpark(Math.max(overdue.length, 1))}
        />
        <KpiTile
          label="Active jobs"
          value={String(activeJobs)}
          delta="open status"
          sparkValues={flatSpark(Math.max(activeJobs, 1))}
        />
        <KpiTile
          label="Reminders · month"
          value={String(remindersMonth)}
          delta="sent"
          positive={remindersMonth > 0}
          sparkValues={growSpark(Math.max(remindersMonth, 10))}
        />
        <KpiTile
          label="Open invoices"
          value={fmtGBP(openInvoicesValue)}
          delta={`${openInvoices.length} outstanding`}
          positive={openInvoices.length === 0}
          sparkValues={flatSpark(Math.max(openInvoicesValue, 100))}
        />
        <KpiTile
          label="Bookings · today"
          value={String(todayBookings)}
          sparkValues={flatSpark(Math.max(todayBookings, 1))}
        />
      </div>

      {/* Day schedule — row 2 */}
      <TodaySchedule bookings={todaySchedule} bays={locationBays} now={now} workStart={businessHoursStart} workEnd={businessHoursEnd} />

      {/* Two-column: revenue chart + priority list */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.5fr 1fr",
          gap: 16,
          marginTop: 20,
          marginBottom: 20,
        }}
      >
        <div
          style={{
            background: "#15181d",
            border: "1px solid #2a2f37",
            borderRadius: 6,
            padding: 22,
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: "#5a6170",
              fontFamily: "var(--font-geist-mono, monospace)",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            Revenue · this week
          </div>
          <div
            style={{
              fontSize: 18,
              fontWeight: 600,
              color: "#e6e8eb",
              marginTop: 4,
              marginBottom: 20,
            }}
          >
            {fmtGBP(weekRevenue)}
            <span
              style={{ fontSize: 13, fontWeight: 400, color: "#9aa1ad", marginLeft: 8 }}
            >
              paid Mon–Sun
            </span>
          </div>
          <WeeklyChart days={weekDays} />
        </div>

        <div
          style={{
            background: "#15181d",
            border: "1px solid #2a2f37",
            borderRadius: 6,
            padding: 22,
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: "#5a6170",
              fontFamily: "var(--font-geist-mono, monospace)",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              marginBottom: 4,
            }}
          >
            Priority actions
          </div>
          <div
            style={{ fontSize: 16, fontWeight: 600, color: "#e6e8eb", marginBottom: 16 }}
          >
            Where to focus now
          </div>
          {priorityItems.map((p, i) => (
            <Link
              key={i}
              href={p.href}
              style={{
                textDecoration: "none",
                display: "grid",
                gridTemplateColumns: "auto 1fr auto",
                gap: 12,
                padding: "12px 0",
                borderTop: i ? "1px solid #2a2f37" : "none",
                alignItems: "flex-start",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-geist-mono, monospace)",
                  fontSize: 11,
                  color: "#5a6170",
                  paddingTop: 2,
                }}
              >
                {p.n}
              </span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#e6e8eb" }}>
                  {p.title}
                </div>
                <div
                  style={{ fontSize: 12, color: "#9aa1ad", marginTop: 3, lineHeight: 1.5 }}
                >
                  {p.body}
                </div>
              </div>
              <div style={{ textAlign: "right", minWidth: 80 }}>
                <div
                  style={{
                    fontFamily: "var(--font-geist-mono, monospace)",
                    fontSize: 12,
                    color: "#5fdd9d",
                    fontWeight: 600,
                  }}
                >
                  {p.impact}
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-geist-mono, monospace)",
                    fontSize: 10,
                    color: "#5a6170",
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                  }}
                >
                  {p.urgency}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Attention queue */}
      <div
        style={{
          background: "#15181d",
          border: "1px solid #2a2f37",
          borderRadius: 6,
        }}
      >
        <div
          style={{
            padding: "16px 22px",
            borderBottom: "1px solid #2a2f37",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 10,
                color: "#5a6170",
                fontFamily: "var(--font-geist-mono, monospace)",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
              }}
            >
              Attention queue
            </div>
            <div
              style={{ fontSize: 16, fontWeight: 600, color: "#e6e8eb", marginTop: 4 }}
            >
              {overdue.length} overdue · {urgent.length} within 14d ·{" "}
              {attentionVehicles.length - overdue.length - urgent.length} upcoming
            </div>
          </div>
          <Link
            href="/staff/reminders"
            style={{
              fontFamily: "var(--font-geist-mono, monospace)",
              fontSize: 11,
              color: "#ffb020",
              textDecoration: "none",
              padding: "6px 12px",
              border: "1px solid #3a2c14",
              borderRadius: 2,
              background: "#1c1810",
            }}
          >
            Send reminders →
          </Link>
        </div>

        {attentionVehicles.length === 0 ? (
          <div
            style={{
              padding: "32px 22px",
              textAlign: "center",
              color: "#5a6170",
              fontFamily: "var(--font-geist-mono, monospace)",
              fontSize: 12,
            }}
          >
            // NO VEHICLES DUE WITHIN 60 DAYS
          </div>
        ) : (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "130px 1fr 1fr 100px 100px 90px",
                padding: "10px 22px",
                borderBottom: "1px solid #2a2f37",
                fontFamily: "var(--font-geist-mono, monospace)",
                fontSize: 10,
                color: "#5a6170",
                letterSpacing: "0.12em",
              }}
            >
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
              const motColor =
                motDays !== null && motDays < 0
                  ? "#ff5b5b"
                  : motDays !== null && motDays <= 14
                  ? "#ffb020"
                  : "#9aa1ad";
              const svcColor =
                svcDays !== null && svcDays < 0
                  ? "#ff5b5b"
                  : svcDays !== null && svcDays <= 14
                  ? "#ffb020"
                  : "#9aa1ad";
              return (
                <div
                  key={v.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "130px 1fr 1fr 100px 100px 90px",
                    padding: "11px 22px",
                    borderBottom:
                      i < attentionVehicles.length - 1 ? "1px solid #2a2f37" : "none",
                    alignItems: "center",
                    fontSize: 13,
                  }}
                >
                  <div>
                    <Plate reg={v.registration} />
                  </div>
                  <div>
                    {v.customer ? (
                      <Link
                        href={`/staff/customers/${v.customer.id}`}
                        style={{ color: "#e6e8eb", textDecoration: "none" }}
                      >
                        {v.customer.full_name ?? "Unnamed"}
                      </Link>
                    ) : (
                      <span style={{ color: "#5a6170" }}>—</span>
                    )}
                  </div>
                  <div style={{ color: "#9aa1ad" }}>
                    {[v.make, v.model].filter(Boolean).join(" ") || "—"}
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-geist-mono, monospace)",
                      fontSize: 12,
                      color: motColor,
                    }}
                  >
                    {motLabel}
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-geist-mono, monospace)",
                      fontSize: 12,
                      color: svcColor,
                    }}
                  >
                    {svcLabel}
                  </div>
                  <div>
                    <StatusBadge status={status} />
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>

    </div>
  );
}
