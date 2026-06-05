import { redirect } from "next/navigation";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/staff/page-header";
import { FeatureGateBanner } from "@/components/staff/feature-gate-banner";
import { entitledTo, UPGRADE_MESSAGE } from "@/lib/tenant-plans";
import { BroadcastForm } from "./broadcast-form";
import { CampaignHistory, type CampaignDetail } from "./campaign-history";

type CampaignRow = {
  subject: string;
  channel: string;
  status: string;
  sent_at: string;
  delivered_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  message_text: string | null;
  error_message: string | null;
  recipient_email: string | null;
  recipient_phone: string | null;
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
      .select(
        "subject, channel, status, sent_at, delivered_at, opened_at, clicked_at, message_text, error_message, recipient_email, recipient_phone",
      )
      .eq("location_id", ctx.location.id)
      .eq("type", "campaign")
      .order("sent_at", { ascending: false })
      .limit(500),
  ]);

  const hasCustomers = (customersRes.count ?? 0) > 0;
  const rows = (campaignsRes.data ?? []) as CampaignRow[];

  const map = new Map<string, CampaignDetail>();
  for (const row of rows) {
    let entry = map.get(row.subject);
    if (!entry) {
      entry = {
        subject: row.subject,
        firstSentAt: row.sent_at,
        lastSentAt: row.sent_at,
        emailSent: 0,
        smsSent: 0,
        failed: 0,
        delivered: 0,
        opened: 0,
        clicked: 0,
        emailBody: null,
        smsBody: null,
        failures: [],
      };
      map.set(row.subject, entry);
    }
    // sent_at extremes — rows arrive in DESC order, so first row seen is the latest.
    if (row.sent_at > entry.lastSentAt) entry.lastSentAt = row.sent_at;
    if (row.sent_at < entry.firstSentAt) entry.firstSentAt = row.sent_at;

    if (row.status === "sent" && row.channel === "email") entry.emailSent++;
    else if (row.status === "sent" && row.channel === "sms") entry.smsSent++;
    else if (row.status !== "sent") {
      entry.failed++;
      if (row.error_message) {
        entry.failures.push({
          recipient: row.recipient_email ?? row.recipient_phone ?? "(unknown)",
          channel: row.channel,
          reason: row.error_message,
        });
      }
    }
    if (row.delivered_at) entry.delivered++;
    if (row.opened_at) entry.opened++;
    if (row.clicked_at) entry.clicked++;

    if (!entry.emailBody && row.channel === "email" && row.message_text) {
      entry.emailBody = row.message_text;
    }
    if (!entry.smsBody && row.channel === "sms" && row.message_text) {
      entry.smsBody = row.message_text;
    }
  }
  const campaigns = [...map.values()].sort(
    (a, b) => b.lastSentAt.localeCompare(a.lastSentAt),
  );

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
  const deliveryDenom = totals.emailSent;
  const openDenom = totals.delivered || totals.emailSent;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Campaigns"
        description="Send marketing messages, promotions, and announcements to all customers at this location."
      />

      {!entitledTo(ctx.tenantBilling, "campaigns") && <FeatureGateBanner message={UPGRADE_MESSAGE.campaigns} />}

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
          <p className="text-xs text-muted-foreground">
            Click any row to expand and see the message that was sent, send time, and individual failure reasons.
          </p>
          <CampaignHistory campaigns={campaigns} />
          <p className="text-xs text-muted-foreground">
            Delivery, open, and click tracking are email-only and require Resend webhooks (delivered/opened/clicked) configured on your domain.
          </p>
        </section>
      )}
    </div>
  );
}
