import { requireStaffContext } from "@/lib/staff-context";
import { PageHeader } from "@/components/staff/page-header";
import { createAdminClient } from "@/lib/supabase/admin";
import { Mail, Smartphone, MessageCircle } from "lucide-react";
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

type ChannelResult = "sent" | "failed";

type ReminderGroup = {
  key: string;
  subject: string;
  type: string;
  sentAt: string;
  customer: { id: string; full_name: string | null } | null;
  vehicle: { registration: string } | null;
  email: ChannelResult | null;
  sms: ChannelResult | null;
  whatsapp: ChannelResult | null;
};

function ChannelBadge({
  icon: Icon,
  status,
  label,
}: {
  icon: React.ElementType;
  status: ChannelResult | null;
  label: string;
}) {
  if (!status) return null;
  const style =
    status === "sent"
      ? "bg-green-100 text-green-700"
      : "bg-red-100 text-red-600";
  return (
    <span
      title={`${label}: ${status}`}
      className={`inline-flex items-center justify-center h-6 w-6 rounded-full ${style}`}
    >
      <Icon className="h-3 w-3" />
    </span>
  );
}

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
    .limit(500)) as { data: ReminderRow[] | null };

  const rows = reminders ?? [];

  // Group rows by customer + subject + date (YYYY-MM-DD HH) — all channels for same send
  const groupMap = new Map<string, ReminderGroup>();

  for (const row of rows) {
    const hourKey = row.sent_at ? row.sent_at.slice(0, 13) : "unknown";
    const key = `${row.customer?.id ?? "none"}|${row.subject}|${hourKey}`;

    if (!groupMap.has(key)) {
      groupMap.set(key, {
        key,
        subject: row.subject,
        type: row.type,
        sentAt: row.sent_at,
        customer: row.customer,
        vehicle: row.vehicle,
        email: null,
        sms: null,
        whatsapp: null,
      });
    }

    const group = groupMap.get(key)!;
    const result: ChannelResult = row.status === "sent" ? "sent" : "failed";

    if (row.channel === "email") group.email = result;
    else if (row.channel === "sms") group.sms = result;
    else if (row.channel === "whatsapp") group.whatsapp = result;
  }

  const groups = [...groupMap.values()];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Reminders"
        description="All messages sent from this location."
      />

      {groups.length === 0 ? (
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
                <th className="px-4 py-2 font-medium">Subject</th>
                <th className="px-4 py-2 font-medium">Channels</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.key} className="border-t">
                  <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">
                    {g.sentAt
                      ? new Date(g.sentAt).toLocaleDateString("en-GB")
                      : "—"}
                  </td>
                  <td className="px-4 py-2">
                    {g.customer ? (
                      <Link
                        href={`/staff/customers/${g.customer.id}`}
                        className="underline"
                      >
                        {g.customer.full_name ?? "Unknown"}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-2 font-mono">
                    {g.vehicle?.registration ?? "—"}
                  </td>
                  <td className="px-4 py-2 capitalize">{g.type}</td>
                  <td className="px-4 py-2 max-w-xs truncate text-muted-foreground" title={g.subject}>
                    {g.subject}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-1.5">
                      <ChannelBadge icon={Mail} status={g.email} label="Email" />
                      <ChannelBadge icon={Smartphone} status={g.sms} label="SMS" />
                      <ChannelBadge icon={MessageCircle} status={g.whatsapp} label="WhatsApp" />
                    </div>
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
