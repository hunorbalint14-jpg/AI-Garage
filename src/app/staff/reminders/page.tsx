import { requireStaffContext } from "@/lib/staff-context";
import { PageHeader } from "@/components/staff/page-header";
import { createAdminClient } from "@/lib/supabase/admin";
import Link from "next/link";

type ReminderRow = {
  id: string;
  type: string;
  channel: string;
  subject: string;
  recipient_email: string | null;
  recipient_phone: string | null;
  status: string;
  sent_at: string;
  customer: { id: string; full_name: string | null } | null;
  vehicle: { registration: string } | null;
};

export default async function RemindersPage() {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  const { data: reminders } = (await admin
    .from("reminders")
    .select(
      "id, type, channel, subject, recipient_email, recipient_phone, status, sent_at, customer:customers(id, full_name), vehicle:vehicles(registration)",
    )
    .eq("location_id", ctx.location.id)
    .order("sent_at", { ascending: false })
    .limit(100)) as { data: ReminderRow[] | null };

  const rows = reminders ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Reminders"
        description="All MOT, service, and custom messages sent from this location."
      />

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
          No messages sent yet. Open a customer record to send one.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Customer</th>
                <th className="px-4 py-2 font-medium">Vehicle</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Channel</th>
                <th className="px-4 py-2 font-medium">Sent to</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-4 py-2 text-muted-foreground">
                    {new Date(r.sent_at).toLocaleDateString("en-GB")}
                  </td>
                  <td className="px-4 py-2">
                    {r.customer ? (
                      <Link href={`/staff/customers/${r.customer.id}`} className="underline">
                        {r.customer.full_name ?? "Unknown"}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-2 font-mono">
                    {r.vehicle?.registration ?? "—"}
                  </td>
                  <td className="px-4 py-2 capitalize">{r.type}</td>
                  <td className="px-4 py-2 uppercase text-xs font-medium">
                    {r.channel}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {r.channel === "sms" ? (r.recipient_phone ?? "—") : (r.recipient_email ?? "—")}
                  </td>
                  <td className="px-4 py-2">
                    <span className={r.status === "sent" ? "text-green-700" : "text-red-600"}>
                      {r.status}
                    </span>
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
