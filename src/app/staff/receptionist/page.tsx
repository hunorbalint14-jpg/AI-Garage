import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/staff/page-header";
import { FeatureGateBanner } from "@/components/staff/feature-gate-banner";
import { entitledTo, UPGRADE_MESSAGE } from "@/lib/tenant-plans";
import { ConfigCard } from "./config-card";
import { ConversationList, type ConversationView } from "./conversation-list";
import type { TranscriptMessage } from "@/lib/receptionist/agent";


export default async function ReceptionistPage() {
  const ctx = await requireStaffContext();
  const canManage = ctx.orgRole === "owner" || ctx.orgRole === "admin";
  const entitled = entitledTo(ctx.tenantBilling, "receptionist");

  const admin = createAdminClient();
  const [configRes, conversationsRes] = await Promise.all([
    admin
      .from("receptionist_configs")
      .select("enabled, twilio_number, forward_to_phone, forward_timeout_seconds")
      .eq("location_id", ctx.location.id)
      .maybeSingle(),
    admin
      .from("receptionist_conversations")
      .select("id, customer_phone, channel, status, source, booking_id, messages, started_at, last_message_at, customer:customers(full_name)")
      .eq("location_id", ctx.location.id)
      .order("last_message_at", { ascending: false })
      .limit(50),
  ]);

  const config = configRes.data as {
    enabled: boolean;
    twilio_number: string | null;
    forward_to_phone: string | null;
    forward_timeout_seconds: number;
  } | null;

  type Row = {
    id: string;
    customer_phone: string;
    channel: string;
    status: string;
    source: string;
    booking_id: string | null;
    messages: TranscriptMessage[];
    started_at: string;
    last_message_at: string;
    customer: { full_name: string | null } | null;
  };
  const conversations: ConversationView[] = ((conversationsRes.data ?? []) as unknown as Row[]).map(
    (r) => ({
      id: r.id,
      customerPhone: r.customer_phone,
      customerName: r.customer?.full_name ?? null,
      channel: r.channel,
      status: r.status,
      source: r.source,
      bookingId: r.booking_id,
      messages: r.messages,
      startedAt: r.started_at,
      lastMessageAt: r.last_message_at,
    }),
  );

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="AI receptionist"
        description="Answers missed calls by text, quotes services, and books customers into real slots — around the clock."
      />

      {!entitled && <FeatureGateBanner message={UPGRADE_MESSAGE.receptionist} />}

      <ConfigCard
        enabled={config?.enabled ?? false}
        twilioNumber={config?.twilio_number ?? null}
        forwardToPhone={config?.forward_to_phone ?? ""}
        forwardTimeoutSeconds={config?.forward_timeout_seconds ?? 20}
        canManage={canManage && entitled}
      />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Conversations
        </h2>
        <ConversationList conversations={conversations} />
      </section>
    </div>
  );
}
