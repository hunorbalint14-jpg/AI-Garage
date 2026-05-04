import Link from "next/link";
import { CalendarPlus } from "lucide-react";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/staff/page-header";

type BookingRow = {
  id: string;
  scheduled_at: string;
  duration_minutes: number;
  type: string;
  status: string;
  notes: string | null;
  customer: { id: string; full_name: string | null } | null;
  vehicle: { registration: string } | null;
};

const STATUS_STYLE: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-700",
  in_progress: "bg-amber-100 text-amber-700",
  complete: "bg-green-100 text-green-700",
  cancelled: "bg-gray-100 text-gray-600",
  no_show: "bg-red-100 text-red-700",
};

function statusLabel(s: string) {
  if (s === "in_progress") return "In progress";
  if (s === "no_show") return "No show";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function typeLabel(t: string) {
  if (t === "mot") return "MOT";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { filter = "upcoming" } = await searchParams;
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  const now = new Date().toISOString();

  let query = admin
    .from("bookings")
    .select("id, scheduled_at, duration_minutes, type, status, notes, customer:customers(id, full_name), vehicle:vehicles(registration)")
    .eq("location_id", ctx.location.id);

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

      <div className="flex gap-2 text-sm">
        {[
          { key: "upcoming", label: "Upcoming" },
          { key: "today", label: "Today" },
          { key: "past", label: "Past" },
          { key: "all", label: "All" },
        ].map((f) => (
          <Link
            key={f.key}
            href={f.key === "upcoming" ? "/staff/bookings" : `/staff/bookings?filter=${f.key}`}
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
          <p className="text-sm text-muted-foreground">
            No bookings to show.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">Date & time</th>
                <th className="px-4 py-2 font-medium">Customer</th>
                <th className="px-4 py-2 font-medium">Vehicle</th>
                <th className="px-4 py-2 font-medium">Type</th>
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
                    ) : "—"}
                  </td>
                  <td className="px-4 py-2 font-mono">{b.vehicle?.registration ?? "—"}</td>
                  <td className="px-4 py-2">{typeLabel(b.type)}</td>
                  <td className="px-4 py-2 text-muted-foreground">{b.duration_minutes} min</td>
                  <td className="px-4 py-2">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[b.status] ?? ""}`}>
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
    </div>
  );
}
