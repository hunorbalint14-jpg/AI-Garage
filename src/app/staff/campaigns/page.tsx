import { redirect } from "next/navigation";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/staff/page-header";
import { BroadcastForm } from "./broadcast-form";

type CampaignRow = {
  subject: string;
  channel: string;
  status: string;
  sent_at: string;
  opened_at: string | null;
  clicked_at: string | null;
};

type CampaignSummary = {
  subject: string;
  sentAt: string;
  emailSent: number;
  smsSent: number;
  failed: number;
  opened: number;
  clicked: number;
};

function pct(num: number, denom: number) {
  if (!denom) return "—";
  return `${Math.round((num / denom) * 100)}%`;
}

export default async function CampaignsPage() {
  const ctx = await requireStaffContext();
  if (!ctx.orgRole) redirect("/staff");

  const admin = createAdminClient();

  const [customersRes, campaignsRes] = await Promise.all([
    admin.from("customers").select("id", { count: "exact", head: true }).eq("location_id", ctx.location.id),
    admin
      .from("reminders")
      .select("subject, channel, status, sent_at, opened_at, clicked_at")
      .eq("location_id", ctx.location.id)
      .eq("type", "campaign")
      .order("sent_at", { ascending: false })
      .limit(500),
  ]);

  const hasCustomers = (customersRes.count ?? 0) > 0;
  const rows = (campaignsRes.data ?? []) as CampaignRow[];

  const map = new Map<string, CampaignSummary>();
  for (const row of rows) {
    if (!map.has(row.subject)) {
      map.set(row.subject, {
        subject: row.subject,
        sentAt: row.sent_at,
        emailSent: 0,
        smsSent: 0,
        failed: 0,
        opened: 0,
        clicked: 0,
      });
    }
    const c = map.get(row.subject)!;
    if (row.status === "sent" && row.channel === "email") c.emailSent++;
    else if (row.status === "sent" && row.channel === "sms") c.smsSent++;
    else if (row.status !== "sent") c.failed++;
    if (row.opened_at) c.opened++;
    if (row.clicked_at) c.clicked++;
  }
  const campaigns = [...map.values()];

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Campaigns"
        description="Send marketing messages, promotions, and announcements to all customers at this location."
      />

      <BroadcastForm hasCustomers={hasCustomers} />

      {campaigns.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Campaign history</h2>
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Subject</th>
                  <th className="px-4 py-2 font-medium text-right">Email</th>
                  <th className="px-4 py-2 font-medium text-right">SMS</th>
                  <th className="px-4 py-2 font-medium text-right">Opened</th>
                  <th className="px-4 py-2 font-medium text-right">Clicked</th>
                  <th className="px-4 py-2 font-medium text-right">Failed</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.subject} className="border-t">
                    <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">
                      {new Date(c.sentAt).toLocaleDateString("en-GB")}
                    </td>
                    <td className="px-4 py-2 max-w-[220px] truncate" title={c.subject}>
                      {c.subject}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{c.emailSent || "—"}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{c.smsSent || "—"}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {c.opened > 0 ? (
                        <span title={`${c.opened} opens`}>
                          {pct(c.opened, c.emailSent)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {c.clicked > 0 ? (
                        <span title={`${c.clicked} clicks`}>
                          {pct(c.clicked, c.emailSent)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {c.failed > 0 ? (
                        <span className="text-red-600">{c.failed}</span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Open and click rates apply to email only. Tracking requires HTML emails and Resend open tracking enabled on your domain.
          </p>
        </section>
      )}
    </div>
  );
}
