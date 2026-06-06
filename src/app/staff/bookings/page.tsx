import Link from "next/link";
import { CalendarPlus } from "lucide-react";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { listLocationStaff } from "@/lib/staff-directory";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/staff/page-header";
import { BookingCalendar } from "./booking-calendar";
import { AssigneeFilter } from "./assignee-filter";
import { StatusFilter } from "./status-filter";
import {
  type BookingRow,
  STATUS_STYLE,
  statusLabel,
  typeLabel,
} from "./booking-display";
import {
  parseMonthParam,
  buildMonthGrid,
  instantDayKey,
} from "./calendar-grid";

const BOOKING_SELECT =
  "id, scheduled_at, duration_minutes, type, status, notes, assigned_to, customer:customers(id, full_name), vehicle:vehicles(registration)";

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; view?: string; month?: string; assignee?: string; status?: string }>;
}) {
  const { filter = "upcoming", view = "calendar", month, assignee = "", status = "" } = await searchParams;
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  const staff = await listLocationStaff(ctx.location.id, ctx.organization.id);
  const nameMap = new Map(staff.map((s) => [s.id, s.name]));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Bookings"
        description="Appointments and scheduled work for this location."
        action={
          <Button
            nativeButton={false}
            render={
              <Link href="/staff/bookings/new">
                <CalendarPlus className="mr-1.5 inline h-4 w-4" />
                New booking
              </Link>
            }
          />
        }
      />

      {/* View toggle + technician filter */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2 text-sm">
          {[
            { key: "calendar", label: "Calendar", href: "/staff/bookings" },
            { key: "list", label: "List", href: "/staff/bookings?view=list" },
          ].map((v) => (
            <Link
              key={v.key}
              href={v.href}
              className={`rounded-md px-3 py-1.5 ${
                view === v.key ? "bg-primary text-primary-foreground" : "hover:bg-muted"
              }`}
            >
              {v.label}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <StatusFilter current={status} />
          <AssigneeFilter staff={staff} current={assignee} />
        </div>
      </div>

      {view === "list"
        ? await renderListView({ filter, assignee, status, locationId: ctx.location.id, admin, nameMap })
        : await renderCalendarView({ month, assignee, status, locationId: ctx.location.id, admin })}
    </div>
  );
}

async function renderCalendarView({
  month,
  assignee,
  status,
  locationId,
  admin,
}: {
  month?: string;
  assignee: string;
  status: string;
  locationId: string;
  admin: ReturnType<typeof createAdminClient>;
}) {
  const { year, month: m } = parseMonthParam(month);
  const grid = buildMonthGrid(year, m);
  const gridStart = grid[0];
  const gridEnd = new Date(grid[41]);
  gridEnd.setDate(gridEnd.getDate() + 1); // exclusive upper bound

  let query = admin
    .from("bookings")
    .select(BOOKING_SELECT)
    .eq("location_id", locationId)
    .gte("scheduled_at", gridStart.toISOString())
    .lt("scheduled_at", gridEnd.toISOString());
  if (assignee) query = query.eq("assigned_to", assignee);
  if (status) query = query.eq("status", status);

  const { data } = (await query
    .order("scheduled_at", { ascending: true })
    .limit(500)) as { data: BookingRow[] | null };

  const monthParam = `${year}-${String(m + 1).padStart(2, "0")}`;
  const todayKey = instantDayKey(new Date().toISOString());

  return (
    <BookingCalendar
      key={monthParam}
      bookings={data ?? []}
      monthParam={monthParam}
      todayKey={todayKey}
    />
  );
}

async function renderListView({
  filter,
  assignee,
  status,
  locationId,
  admin,
  nameMap,
}: {
  filter: string;
  assignee: string;
  status: string;
  locationId: string;
  admin: ReturnType<typeof createAdminClient>;
  nameMap: Map<string, string>;
}) {
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
  const rows = bookings ?? [];

  return (
    <>
      <div className="flex gap-2 text-sm">
        {[
          { key: "upcoming", label: "Upcoming" },
          { key: "today", label: "Today" },
          { key: "past", label: "Past" },
          { key: "all", label: "All" },
        ].map((f) => (
          <Link
            key={f.key}
            href={`/staff/bookings?view=list&filter=${f.key}`}
            className={`rounded-md px-3 py-1.5 ${
              filter === f.key ? "bg-primary text-primary-foreground" : "hover:bg-muted"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-sm text-muted-foreground">No bookings to show.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[700px] text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">Date &amp; time</th>
                <th className="px-4 py-2 font-medium">Customer</th>
                <th className="px-4 py-2 font-medium">Vehicle</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Technician</th>
                <th className="px-4 py-2 font-medium">Duration</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id} className="border-t">
                  <td className="px-4 py-2 whitespace-nowrap">
                    {new Date(b.scheduled_at).toLocaleString("en-GB", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="px-4 py-2">
                    {b.customer ? (
                      <Link href={`/staff/customers/${b.customer.id}`} className="underline">
                        {b.customer.full_name ?? "Unknown"}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-2 font-mono">{b.vehicle?.registration ?? "—"}</td>
                  <td className="px-4 py-2">{typeLabel(b.type)}</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {b.assigned_to ? (nameMap.get(b.assigned_to) ?? "—") : "—"}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{b.duration_minutes} min</td>
                  <td className="px-4 py-2">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                        STATUS_STYLE[b.status] ?? ""
                      }`}
                    >
                      {statusLabel(b.status)}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link href={`/staff/bookings/${b.id}`} className="text-sm underline">
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
