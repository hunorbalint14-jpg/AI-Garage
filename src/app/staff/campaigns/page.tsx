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
  delivered_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
};

type CampaignSummary = {
  subject: string;
  sentAt: string;
  emailSent: number;
  smsSent: number;
  failed: number;
  delivered: number;
  opened: number;
  clicked: number;
};

function pct(num: number, denom: number) {
  if (!denom) return "—";
  return `${Math.round((num / denom) * 100)}%`;
}

function KpiCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

export default async function CampaignsPage() {
  const ctx = await requireStaffContext();
  if (!ctx.orgRole) redirect("/staff");

  const admin = createAdminClient();

  const [customersRes, campaignsRes] = await Promise.all([
    admin.from("customers").select("id", { count: "exact", head: true }).eq("location_id", ctx.location.id),
    admin
      .from("reminders")
      .select("subject, channel, status, sent_at, delivered_at, opened_at, clicked_at")
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
        delivered: 0,
        opened: 0,
        clicked: 0,
      });
    }
    const c = map.get(row.subject)!;
    if (row.status === "sent" && row.channel === "email") c.emailSent++;
    else if (row.status === "sent" && row.channel === "sms") c.smsSent++;
    else if (row.status !== "sent") c.failed++;
    if (row.delivered_at) c.delivered++;
    if (row.opened_at) c.opened++;
    if (row.clicked_at) c.clicked++;
  }
  const campaigns = [...map.values()];

  // Roll-up KPIs across all campaigns at this location.
  const totals = campaigns.reduce(
    (acc, c) => {
      acc.emailSent += c.emailSent;
      acc.smsSent += c.smsSent;
      acc.delivered += c.delivered;
      acc.opened += c.opened;
      acc.clicked += c.clicked;
      acc.failed += c.failed;
      return acc;
    },
    { emailSent: 0, smsSent: 0, delivered: 0, opened: 0, clicked: 0, failed: 0 },
  );
  const totalSent = totals.emailSent + totals.smsSent;
  const deliveryDenom = totals.emailSent; // delivery webhooks only fire for email
  const openDenom = totals.delivered || totals.emailSent;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Campaigns"
        description="Send marketing messages, promotions, and announcements to all customers at this location."
      />

      <BroadcastForm hasCustomers={hasCustomers} />

      {campaigns.length > 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">Performance overview</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <KpiCard
              label="Campaigns"
              value={campaigns.length}
              sub={`across ${totalSent} messages`}
            />
            <KpiCard
              label="Total sent"
              value={totalSent}
              sub={`${totals.emailSent} email · ${totals.smsSent} SMS`}
            />
            <KpiCard
              label="Delivered"
              value={totals.delivered}
              sub={`${pct(totals.delivered, deliveryDenom)} of email`}
            />
            <KpiCard
              label="Opened"
              value={totals.opened}
              sub={`${pct(totals.opened, openDenom)} open rate`}
            />
            <KpiCard
              label="Clicked"
              value={totals.clicked}
              sub={`${pct(totals.clicked, openDenom)} click rate`}
            />
          </div>

          <h2 className="mt-2 text-lg font-semibold">Campaign history</h2>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Subject</th>
                  <th className="px-4 py-2 font-medium text-right">Sent</th>
                  <th className="px-4 py-2 font-medium text-right">Delivered</th>
                  <th className="px-4 py-2 font-medium text-right">Opened</th>
                  <th className="px-4 py-2 font-medium text-right">Clicked</th>
                  <th className="px-4 py-2 font-medium text-right">Failed</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => {
                  const sent = c.emailSent + c.smsSent;
                  const openBase = c.delivered || c.emailSent;
                  return (
                    <tr key={c.subject} className="border-t">
                      <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">
                        {new Date(c.sentAt).toLocaleDateString("en-GB")}
                      </td>
                      <td className="px-4 py-2 max-w-[260px] truncate" title={c.subject}>
                        {c.subject}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums" title={`${c.emailSent} email · ${c.smsSent} SMS`}>
                        {sent || "—"}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {c.emailSent > 0 ? (
                          <span title={`${c.delivered}/${c.emailSent} confirmed delivered`}>
                            {c.delivered}{" "}
                            <span className="text-xs text-muted-foreground">
                              ({pct(c.delivered, c.emailSent)})
                            </span>
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {c.opened > 0 ? (
                          <span title={`${c.opened} opens of ${openBase}`}>
                            {c.opened}{" "}
                            <span className="text-xs text-muted-foreground">
                              ({pct(c.opened, openBase)})
                            </span>
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {c.clicked > 0 ? (
                          <span title={`${c.clicked} clicks of ${openBase}`}>
                            {c.clicked}{" "}
                            <span className="text-xs text-muted-foreground">
                              ({pct(c.clicked, openBase)})
                            </span>
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
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Delivery, open, and click tracking are email-only and require Resend webhooks (delivered/opened/clicked) configured on your domain.
          </p>
        </section>
      )}
    </div>
  );
}
