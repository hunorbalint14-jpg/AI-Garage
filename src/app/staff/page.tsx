import Link from "next/link";
import { redirect } from "next/navigation";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";

type Vehicle = {
  id: string;
  registration: string;
  make: string | null;
  model: string | null;
  mot_expiry: string | null;
  service_due: string | null;
  customer: { id: string; full_name: string | null } | null;
};

function dueDays(d: string): number {
  return Math.ceil((new Date(d).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: number | string;
  sub?: string;
  accent?: "red" | "amber" | "green";
}) {
  const colours = {
    red: "border-red-200 bg-red-50 text-red-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    green: "border-green-200 bg-green-50 text-green-700",
  };
  return (
    <div
      className={`rounded-lg border p-4 ${accent ? colours[accent] : "border-border bg-card"}`}
    >
      <p className="text-sm font-medium opacity-70">{label}</p>
      <p className="mt-1 text-3xl font-bold">{value}</p>
      {sub && <p className="mt-1 text-xs opacity-60">{sub}</p>}
    </div>
  );
}

export default async function StaffDashboard() {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  const now = new Date();
  const in30 = new Date(now);
  in30.setDate(in30.getDate() + 30);
  const in60 = new Date(now);
  in60.setDate(in60.getDate() + 60);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const [
    customersRes,
    vehiclesRes,
    remindersThisMonthRes,
    attentionVehiclesRes,
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

    // Vehicles with MOT or service due within 60 days
    admin
      .from("vehicles")
      .select(
        "id, registration, make, model, mot_expiry, service_due, customer:customers(id, full_name)",
      )
      .eq("location_id", ctx.location.id)
      .or(
        `mot_expiry.lte.${in60.toISOString().split("T")[0]},service_due.lte.${in60.toISOString().split("T")[0]}`,
      )
      .order("mot_expiry", { ascending: true })
      .limit(20),
  ]);

  const totalCustomers = customersRes.count ?? 0;
  const totalVehicles = vehiclesRes.count ?? 0;
  const remindersThisMonth = remindersThisMonthRes.count ?? 0;
  const attentionVehicles = (attentionVehiclesRes.data ?? []) as unknown as Vehicle[];

  // Split into overdue/urgent/upcoming
  const overdue = attentionVehicles.filter((v) => {
    const m = v.mot_expiry ? dueDays(v.mot_expiry) : null;
    const s = v.service_due ? dueDays(v.service_due) : null;
    return (m !== null && m < 0) || (s !== null && s < 0);
  });
  const urgentCount = attentionVehicles.filter((v) => {
    const m = v.mot_expiry ? dueDays(v.mot_expiry) : null;
    const s = v.service_due ? dueDays(v.service_due) : null;
    return (
      ((m !== null && m >= 0 && m <= 30) || (s !== null && s >= 0 && s <= 30)) &&
      !overdue.includes(v)
    );
  }).length;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Customers" value={totalCustomers} />
        <StatCard label="Vehicles" value={totalVehicles} />
        <StatCard
          label="Overdue"
          value={overdue.length}
          sub="MOT or service past due"
          accent={overdue.length > 0 ? "red" : undefined}
        />
        <StatCard
          label="Reminders this month"
          value={remindersThisMonth}
          accent={remindersThisMonth > 0 ? "green" : undefined}
        />
      </div>

      {/* Vehicles needing attention */}
      <section>
        <h2 className="mb-3 text-lg font-semibold">Vehicles needing attention</h2>
        {attentionVehicles.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            No vehicles due within the next 60 days. 🎉
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-4 py-2 font-medium">Customer</th>
                  <th className="px-4 py-2 font-medium">Registration</th>
                  <th className="px-4 py-2 font-medium">MOT expiry</th>
                  <th className="px-4 py-2 font-medium">Service due</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {attentionVehicles.map((v) => {
                  const motDays = v.mot_expiry ? dueDays(v.mot_expiry) : null;
                  const svcDays = v.service_due ? dueDays(v.service_due) : null;
                  const isOverdue =
                    (motDays !== null && motDays < 0) ||
                    (svcDays !== null && svcDays < 0);
                  const isUrgent =
                    !isOverdue &&
                    ((motDays !== null && motDays <= 30) ||
                      (svcDays !== null && svcDays <= 30));

                  return (
                    <tr key={v.id} className="border-t">
                      <td className="px-4 py-2">
                        {v.customer ? (
                          <Link
                            href={`/staff/customers/${v.customer.id}`}
                            className="underline"
                          >
                            {v.customer.full_name ?? "Unnamed"}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-2 font-mono">{v.registration}</td>
                      <td
                        className={`px-4 py-2 ${motDays !== null && motDays <= 30 ? "font-semibold text-red-600" : motDays !== null && motDays <= 60 ? "font-medium text-amber-600" : ""}`}
                      >
                        {v.mot_expiry
                          ? new Date(v.mot_expiry).toLocaleDateString("en-GB")
                          : "—"}
                      </td>
                      <td
                        className={`px-4 py-2 ${svcDays !== null && svcDays <= 30 ? "font-semibold text-red-600" : svcDays !== null && svcDays <= 60 ? "font-medium text-amber-600" : ""}`}
                      >
                        {v.service_due
                          ? new Date(v.service_due).toLocaleDateString("en-GB")
                          : "—"}
                      </td>
                      <td className="px-4 py-2">
                        {isOverdue ? (
                          <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">
                            Overdue
                          </span>
                        ) : isUrgent ? (
                          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                            Due soon
                          </span>
                        ) : (
                          <span className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700">
                            Upcoming
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {urgentCount > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            {urgentCount} vehicle{urgentCount !== 1 ? "s" : ""} due within 30 days — consider sending reminders.
          </p>
        )}
      </section>
    </div>
  );
}
