import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { Button } from "@/components/ui/button";
import { ReminderButton } from "./reminder-button";
import { DeleteCustomerButton, DeleteVehicleButton } from "./delete-buttons";
import { DraftMessagePanel } from "./draft-message-panel";
import { StaffDiagnostic } from "./staff-diagnostic";

type Customer = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  created_at: string;
};

type Vehicle = {
  id: string;
  registration: string;
  make: string | null;
  model: string | null;
  year: number | null;
  mot_expiry: string | null;
  service_due: string | null;
  tax_due_date: string | null;
};

type Reminder = {
  id: string;
  type: string;
  subject: string;
  status: string;
  sent_at: string;
};

function formatDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB");
}

function dueDateClass(d: string | null): string {
  if (!d) return "";
  const days = Math.ceil(
    (new Date(d).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
  );
  if (days <= 30) return "text-red-600 font-semibold";
  if (days <= 60) return "text-amber-600 font-medium";
  return "";
}

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  const [customerRes, vehiclesRes, remindersRes] = await Promise.all([
    admin
      .from("customers")
      .select("id, full_name, email, phone, created_at")
      .eq("id", id)
      .maybeSingle(),
    admin
      .from("vehicles")
      .select("id, registration, make, model, year, mot_expiry, service_due, tax_due_date")
      .eq("customer_id", id)
      .order("created_at", { ascending: false }),
    admin
      .from("reminders")
      .select("id, type, subject, status, sent_at")
      .eq("customer_id", id)
      .order("sent_at", { ascending: false })
      .limit(10),
  ]);

  // Verify customer belongs to this location
  const customerCheck = await ctx.supabase
    .from("customers")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (!customerCheck.data) notFound();

  const customer = customerRes.data as Customer | null;
  if (!customer) notFound();

  const vehicles = (vehiclesRes.data ?? []) as Vehicle[];
  const reminders = (remindersRes.data ?? []) as Reminder[];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            href="/staff/customers"
            className="text-sm text-muted-foreground underline"
          >
            ← Back to customers
          </Link>
          <h1 className="text-2xl font-bold">
            {customer.full_name ?? "Unnamed customer"}
          </h1>
        </div>
        <div className="flex shrink-0 gap-2 pt-5">
          <Button
            nativeButton={false}
            variant="outline"
            size="sm"
            render={<Link href={`/staff/customers/${customer.id}/edit`}>Edit</Link>}
          />
          <DeleteCustomerButton customerId={customer.id} />
        </div>
      </div>

      <section className="rounded-lg border p-4">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Contact
        </h2>
        <dl className="grid grid-cols-[120px_1fr] gap-y-1 text-sm">
          <dt className="text-muted-foreground">Email</dt>
          <dd>{customer.email ?? "—"}</dd>
          <dt className="text-muted-foreground">Phone</dt>
          <dd>{customer.phone ?? "—"}</dd>
          <dt className="text-muted-foreground">Customer since</dt>
          <dd>{formatDate(customer.created_at)}</dd>
        </dl>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Vehicles</h2>
          <Button
            nativeButton={false}
            render={
              <Link href={`/staff/customers/${customer.id}/vehicles/new`}>
                Add vehicle
              </Link>
            }
          />
        </div>

        {vehicles.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            No vehicles on file for this customer yet.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-4 py-2 font-medium">Registration</th>
                  <th className="px-4 py-2 font-medium">Vehicle</th>
                  <th className="px-4 py-2 font-medium">Year</th>
                  <th className="px-4 py-2 font-medium">MOT expiry</th>
                  <th className="px-4 py-2 font-medium">Service due</th>
                  <th className="px-4 py-2 font-medium">Road tax</th>
                  <th className="px-4 py-2 font-medium">Reminders</th>
                </tr>
              </thead>
              <tbody>
                {vehicles.map((v) => (
                  <tr key={v.id} className="border-t align-top">
                    <td className="px-4 py-2 font-mono">{v.registration}</td>
                    <td className="px-4 py-2">
                      {[v.make, v.model].filter(Boolean).join(" ") || "—"}
                    </td>
                    <td className="px-4 py-2">{v.year ?? "—"}</td>
                    <td className={`px-4 py-2 ${dueDateClass(v.mot_expiry)}`}>
                      {formatDate(v.mot_expiry)}
                    </td>
                    <td className={`px-4 py-2 ${dueDateClass(v.service_due)}`}>
                      {formatDate(v.service_due)}
                    </td>
                    <td className={`px-4 py-2 ${dueDateClass(v.tax_due_date)}`}>
                      {formatDate(v.tax_due_date)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-2">
                        <ReminderButton
                          vehicleId={v.id}
                          reminderType="mot"
                          disabled={!v.mot_expiry || (!customer.email && !customer.phone)}
                        />
                        <ReminderButton
                          vehicleId={v.id}
                          reminderType="service"
                          disabled={!v.service_due || (!customer.email && !customer.phone)}
                        />
                        <div className="flex gap-2 text-xs pt-1 border-t">
                          <Link
                            href={`/staff/customers/${customer.id}/vehicles/${v.id}/edit`}
                            className="underline text-muted-foreground"
                          >
                            Edit
                          </Link>
                          <DeleteVehicleButton
                            vehicleId={v.id}
                            customerId={customer.id}
                          />
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-2 text-xs text-muted-foreground">
          <span className="text-red-600 font-semibold">Red</span> = due within
          30 days or overdue.{" "}
          <span className="text-amber-600 font-medium">Amber</span> = due within
          60 days. Reminders send to all available channels (email + SMS + WhatsApp). MOT and service only.
          Buttons disabled if no date set or no contact details on file.
        </p>
      </section>

      <DraftMessagePanel
        customerId={customer.id}
        hasEmail={!!customer.email}
        hasPhone={!!customer.phone}
      />

      {vehicles.length > 0 && (
        <StaffDiagnostic vehicles={vehicles.map((v) => ({ id: v.id, registration: v.registration, make: v.make, model: v.model }))} />
      )}

      {reminders.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Reminder history</h2>
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 font-medium">Subject</th>
                  <th className="px-4 py-2 font-medium">Sent</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {reminders.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="px-4 py-2 capitalize">{r.type}</td>
                    <td className="px-4 py-2 max-w-xs truncate" title={r.subject}>
                      {r.subject}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {new Date(r.sent_at).toLocaleDateString("en-GB")}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={
                          r.status === "sent"
                            ? "text-green-700"
                            : "text-red-600"
                        }
                      >
                        {r.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
