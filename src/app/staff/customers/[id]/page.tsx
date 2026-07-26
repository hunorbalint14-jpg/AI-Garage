import Link from "next/link";
import { notFound } from "next/navigation";
import { Mail, MapPin, Phone } from "lucide-react";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { ReminderButton } from "./reminder-button";
import { DeleteVehicleButton } from "./delete-buttons";
import { DraftMessagePanel } from "./draft-message-panel";
import { StaffDiagnostic } from "./staff-diagnostic";
import { GdprPanel } from "./gdpr-panel";
import { ReminderHistory, type ReminderHistoryItem } from "./reminder-history";
import { PlanInvitePanel, type InvitePlanOption } from "./plan-invite-panel";
import { MembershipsSection, type MembershipRow } from "./memberships-section";
import { isSubscriptionLive } from "@/lib/service-plans";
import { HomeGarageSelect } from "@/components/home-garage-select";
import { setCustomerHomeGarage } from "../actions";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { deferredFindingsForVehicles, type DeferredFinding } from "@/lib/deferred-work";
import { DeferredWorkPanel } from "@/components/staff/deferred-work-panel";
import { hasPermission } from "@/lib/permissions";
import { accountBalance } from "@/lib/account";
import { AccountSection } from "./account-section";
import { ServiceHistorySection, type HistoryEntryRow } from "./service-history-section";
import { ImportedInvoicesSection, type ImportedInvoiceRow } from "./imported-invoices-section";
import { computeInsight, daysUntil, scanClock } from "@/lib/customer-insights";
import {
  DuePill,
  HealthAvatar,
  HealthRing,
  PlateChip,
  SECTION_CLASS,
  SectionLabel,
  fmtGBP,
  fmtGBP0,
} from "../customers-ui";
import { CopilotBand } from "./copilot-band";
import { RecordTopBar } from "./record-topbar";

type Customer = {
  id: string;
  organization_id: string;
  preferred_location_id: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  created_at: string;
  is_demo: boolean;
  marketing_email_consent: boolean;
  marketing_sms_consent: boolean;
  consent_updated_at: string | null;
  anonymized_at: string | null;
  account_customer: boolean;
  payment_terms_days: number;
  credit_limit: number | null;
  consolidated_billing: boolean;
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
  vehicle_id: string | null;
  type: string;
  channel: string;
  subject: string;
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

type ActivityTone = "info" | "success" | "neutral" | "warning";
type ActivityItem = { key: string; at: string; text: string; tone: ActivityTone };

const DOT_CLASS: Record<ActivityTone, string> = {
  info: "bg-ws-blue",
  success: "bg-ws-green",
  neutral: "bg-ws-text-2",
  warning: "bg-ws-amber",
};

const fmtDay = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }).toUpperCase() : "—";

const fmtLongDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";

export default async function CustomerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  // `tab` is a legacy param from the old tabbed layout — the record is one
  // scrolling page now, so it is accepted and ignored; `draft` still seeds the
  // composer (the low-score recovery deep link from /review/[token]).
  searchParams: Promise<{ tab?: string; draft?: string }>;
}) {
  const { id } = await params;
  const { draft: draftTopic } = await searchParams;
  const ctx = await requireStaffContext();
  const admin = createAdminClient();
  const now = scanClock();
  const locationIds = ctx.accessibleLocations.map((l) => l.id);

  const [
    customerRes,
    vehiclesRes,
    remindersRes,
    plansRes,
    membershipsRes,
    pulsesRes,
    jobsRes,
    invoicesRes,
    bookingsRes,
    quotesRes,
  ] = await Promise.all([
    admin
      .from("customers")
      .select("id, organization_id, preferred_location_id, full_name, email, phone, created_at, is_demo, marketing_email_consent, marketing_sms_consent, consent_updated_at, anonymized_at, account_customer, payment_terms_days, credit_limit, consolidated_billing")
      .eq("id", id)
      .maybeSingle(),
    admin
      .from("vehicles")
      .select("id, registration, make, model, year, mot_expiry, service_due, tax_due_date")
      .eq("customer_id", id)
      .order("created_at", { ascending: false }),
    admin
      .from("reminders")
      .select(
        "id, vehicle_id, type, channel, subject, status, sent_at, delivered_at, opened_at, clicked_at, message_text, error_message, recipient_email, recipient_phone",
      )
      .eq("customer_id", id)
      .order("sent_at", { ascending: false })
      .limit(200),
    admin
      .from("service_plans")
      .select("id, name")
      .eq("organization_id", ctx.organization.id)
      .eq("active", true)
      .order("name", { ascending: true }),
    admin
      .from("plan_subscriptions")
      .select("id, status, interval, current_period_end, cancel_at_period_end, benefits_start_at, service_plan:service_plans(name, discount_type, discount_value)")
      .eq("customer_id", id)
      .eq("organization_id", ctx.organization.id)
      .order("created_at", { ascending: false }),
    admin
      .from("review_requests")
      .select("id, score, feedback_text, responded_at, job_id")
      .eq("customer_id", id)
      .eq("status", "responded")
      .order("responded_at", { ascending: false })
      .limit(10),
    admin
      .from("jobs")
      .select("id, description, status, completed_at, created_at")
      .eq("customer_id", id)
      .in("location_id", locationIds)
      .order("created_at", { ascending: false })
      .limit(100),
    admin
      .from("invoices")
      .select("id, invoice_number, total, amount_paid, status, paid_at, issued_at, created_at")
      .eq("customer_id", id)
      .order("created_at", { ascending: false })
      .limit(100),
    admin
      .from("bookings")
      .select("id, scheduled_at, type, status, created_at")
      .eq("customer_id", id)
      .order("scheduled_at", { ascending: false })
      .limit(50),
    admin
      .from("quotes")
      .select("id, total, sent_at")
      .eq("customer_id", id)
      .eq("status", "pending")
      .order("sent_at", { ascending: false, nullsFirst: false })
      .limit(1),
  ]);

  // Tenant isolation: customers are org-global, so the row must belong to the
  // staff member's ORGANISATION (any branch) — the same RLS-independent check
  // the job/booking detail pages make.
  const customer = customerRes.data as Customer | null;
  if (!customer || customer.organization_id !== ctx.organization.id) notFound();

  const vehicles = (vehiclesRes.data ?? []) as Vehicle[];
  const reminders = (remindersRes.data ?? []) as Reminder[];
  const jobs = (jobsRes.data ?? []) as {
    id: string;
    description: string | null;
    status: string;
    completed_at: string | null;
    created_at: string;
  }[];
  const invoices = (invoicesRes.data ?? []) as {
    id: string;
    invoice_number: string;
    total: number;
    amount_paid: number | null;
    status: string;
    paid_at: string | null;
    issued_at: string | null;
    created_at: string;
  }[];
  const bookings = (bookingsRes.data ?? []) as {
    id: string;
    scheduled_at: string;
    type: string;
    status: string;
    created_at: string;
  }[];

  // Imported service history (#505): pre-platform work, read-only.
  const { data: historyRows } = vehicles.length
    ? await admin
        .from("vehicle_history_entries")
        .select("id, vehicle_id, happened_on, mileage, description, total, source")
        .in("vehicle_id", vehicles.map((v) => v.id))
        .order("happened_on", { ascending: false })
        .limit(200)
    : { data: [] };
  const historyEntries = (historyRows ?? []) as HistoryEntryRow[];

  // Imported invoices (#505 PR 3): read-only pre-platform documents.
  const { data: importedInvRows } = await admin
    .from("imported_invoices")
    .select("id, invoice_number, issued_on, total, status, description")
    .eq("customer_id", customer.id)
    .order("issued_on", { ascending: false })
    .limit(100);
  const importedInvoices = (importedInvRows ?? []) as ImportedInvoiceRow[];

  // eVHC deferred-work bank (#497): outstanding advisories per vehicle.
  const deferredByVehicle = (await isFeatureEnabled("evhc"))
    ? await deferredFindingsForVehicles(admin, vehicles.map((v) => v.id))
    : new Map<string, DeferredFinding[]>();
  const deferredFindings = vehicles.flatMap((v) => deferredByVehicle.get(v.id) ?? []);
  const planOptions = (plansRes.data ?? []) as InvitePlanOption[];
  const memberships = (membershipsRes.data ?? []) as unknown as MembershipRow[];
  const liveMembership = memberships.find((m) => isSubscriptionLive(m.status)) ?? null;
  const pulses = (pulsesRes.data ?? []) as {
    id: string;
    score: number | null;
    feedback_text: string | null;
    responded_at: string | null;
    job_id: string;
  }[];

  // ── Derived facts: the same numbers the list scores on ───────────────────
  const openBalance =
    Math.round(
      invoices
        .filter((i) => i.status === "sent")
        .reduce((sum, i) => sum + Math.max(0, Number(i.total) - Number(i.amount_paid ?? 0)), 0) * 100,
    ) / 100;
  const lifetimeValue = invoices
    .filter((i) => i.status === "paid")
    .reduce((sum, i) => sum + Number(i.total), 0);
  const completedJobs = jobs.filter((j) => j.status === "complete");
  const lastJobAt = completedJobs.map((j) => j.completed_at).filter(Boolean).sort().at(-1) ?? null;
  const lastPaidAt = invoices.filter((i) => i.paid_at).map((i) => i.paid_at as string).sort().at(-1) ?? null;
  const lastVisitAt =
    lastJobAt && lastPaidAt ? (lastJobAt > lastPaidAt ? lastJobAt : lastPaidAt) : (lastJobAt ?? lastPaidAt);
  const openQuoteRow = ((quotesRes.data ?? []) as { id: string; total: number; sent_at: string | null }[])[0] ?? null;

  const insight = computeInsight({
    fullName: customer.full_name,
    vehicles: vehicles.map((v) => ({
      id: v.id,
      registration: v.registration,
      motExpiry: v.mot_expiry,
      serviceDue: v.service_due,
      taxDue: v.tax_due_date,
    })),
    balance: openBalance,
    lifetimeValue,
    visitCount: completedJobs.length,
    lastVisitAt,
    createdAt: customer.created_at,
    hasPlan: !!liveMembership,
    openQuote: openQuoteRow
      ? { id: openQuoteRow.id, total: Number(openQuoteRow.total), sentAt: openQuoteRow.sent_at }
      : null,
    remindersSent: reminders.length,
    remindersOpened: reminders.filter((r) => r.opened_at).length,
    lastReminderAt: reminders[0]?.sent_at ?? null,
    now,
  });

  // Group reminder rows by vehicle + type + 5-minute bucket so all channels
  // sent in one "Send reminder" action collapse into a single row.
  const regByVehicleId = new Map(vehicles.map((v) => [v.id, v.registration]));
  const reminderGroups = new Map<string, ReminderHistoryItem>();
  for (const r of reminders) {
    const bucket = Math.floor(new Date(r.sent_at).getTime() / (5 * 60 * 1000));
    const key = `${r.vehicle_id ?? "_"}|${r.type}|${bucket}`;
    let group = reminderGroups.get(key);
    if (!group) {
      group = {
        groupKey: key,
        type: r.type,
        subject: r.subject,
        sentAt: r.sent_at,
        vehicleRegistration: r.vehicle_id ? regByVehicleId.get(r.vehicle_id) ?? null : null,
        channels: [],
      };
      reminderGroups.set(key, group);
    }
    if (new Date(r.sent_at).getTime() > new Date(group.sentAt).getTime()) {
      group.sentAt = r.sent_at;
    }
    const channel = (r.channel === "sms" || r.channel === "whatsapp" ? r.channel : "email") as
      | "email"
      | "sms"
      | "whatsapp";
    if (!group.channels.find((c) => c.channel === channel)) {
      group.channels.push({
        channel,
        status: r.status === "bounced" ? "bounced" : r.status === "failed" ? "failed" : "sent",
        recipient: r.recipient_email ?? r.recipient_phone ?? null,
        body: r.message_text,
        error: r.error_message,
        deliveredAt: r.delivered_at,
        openedAt: r.opened_at,
        clickedAt: r.clicked_at,
      });
    }
  }
  const reminderItems = [...reminderGroups.values()].sort(
    (a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime(),
  );

  // ── Unified activity feed ────────────────────────────────────────────────
  const activity: ActivityItem[] = [];

  for (const group of reminderItems) {
    const channels = group.channels.map((c) => (c.channel === "sms" ? "SMS" : c.channel === "whatsapp" ? "WhatsApp" : "email"));
    const opened = group.channels.some((c) => c.openedAt);
    const failed = group.channels.every((c) => c.status !== "sent");
    const label = group.type === "custom" ? "Message" : `${group.type.toUpperCase()} reminder`;
    activity.push({
      key: `rem-${group.groupKey}`,
      at: group.sentAt,
      text: `${label} sent — ${channels.join(" + ")}${group.vehicleRegistration ? ` · ${group.vehicleRegistration}` : ""}${
        failed ? " · delivery failed" : opened ? " · opened" : ""
      }`,
      tone: failed ? "warning" : opened ? "info" : "neutral",
    });
  }

  for (const p of pulses) {
    if (!p.responded_at) continue;
    activity.push({
      key: `pulse-${p.id}`,
      at: p.responded_at,
      text: `Left ${p.score ?? "—"}★ feedback${p.feedback_text ? ` — “${p.feedback_text.slice(0, 90)}”` : ""}`,
      tone: (p.score ?? 0) >= 4 ? "success" : "warning",
    });
  }

  for (const j of completedJobs) {
    if (!j.completed_at) continue;
    activity.push({
      key: `job-${j.id}`,
      at: j.completed_at,
      text: `Job completed — ${j.description?.trim() || "workshop job"}`,
      tone: "neutral",
    });
  }

  for (const inv of invoices) {
    if (inv.status === "paid" && inv.paid_at) {
      activity.push({
        key: `inv-${inv.id}`,
        at: inv.paid_at,
        text: `Invoice ${inv.invoice_number} paid · ${fmtGBP(Number(inv.total))}`,
        tone: "success",
      });
    } else if (inv.status === "sent") {
      activity.push({
        key: `inv-${inv.id}`,
        at: inv.issued_at ?? inv.created_at,
        text: `Invoice ${inv.invoice_number} issued · ${fmtGBP(Number(inv.total))} outstanding`,
        tone: "warning",
      });
    }
  }

  for (const b of bookings) {
    activity.push({
      key: `book-${b.id}`,
      at: b.created_at ?? b.scheduled_at,
      text: `Booking ${b.status === "cancelled" ? "cancelled" : "created"} — ${b.type} on ${fmtLongDate(b.scheduled_at)}`,
      tone: b.status === "cancelled" || b.status === "no_show" ? "warning" : "neutral",
    });
  }

  activity.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  const activityItems = activity.slice(0, 25);

  const homeBranchName =
    ctx.accessibleLocations.find((l) => l.id === customer.preferred_location_id)?.name ?? null;
  const multiBranch = ctx.accessibleLocations.length > 1;

  return (
    <div className="animate-cd-fade-up flex flex-col gap-5">
      <RecordTopBar customerId={customer.id} />

      {/* Hero */}
      <section className={`${SECTION_CLASS} flex flex-wrap items-center gap-5 p-5`}>
        <HealthAvatar name={customer.full_name} health={insight.health} size={56} />

        <div className="min-w-[220px] flex-1">
          <h1 className="text-[22px] font-bold tracking-[-0.4px] text-[#fafafa]">
            {customer.full_name ?? "Unnamed customer"}{" "}
            {customer.is_demo && (
              <span className="inline-flex rounded-[4px] border border-amber-500/40 bg-amber-500/10 px-1.5 py-px align-middle font-mono text-[9px] uppercase tracking-[0.1em] text-amber-400">
                demo
              </span>
            )}
          </h1>
          <div className="mt-2 flex min-w-0 flex-wrap gap-1.5">
            <ContactChip icon={<Mail className="h-3 w-3 flex-none" />}>
              {customer.email ?? "no email on file"}
            </ContactChip>
            <ContactChip icon={<Phone className="h-3 w-3 flex-none" />}>
              {customer.phone ?? "no phone on file"}
            </ContactChip>
            {multiBranch ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-ws-border bg-ws-page px-2.5 py-[3px] text-[12px] text-ws-text-2">
                <MapPin className="h-3 w-3 flex-none" />
                <HomeGarageSelect
                  branches={ctx.accessibleLocations.map((l) => ({ id: l.id, name: l.name }))}
                  currentId={customer.preferred_location_id}
                  action={setCustomerHomeGarage.bind(null, customer.id)}
                />
              </span>
            ) : (
              homeBranchName && (
                <ContactChip icon={<MapPin className="h-3 w-3 flex-none" />}>{homeBranchName}</ContactChip>
              )
            )}
            <ContactChip>Customer since {fmtLongDate(customer.created_at)}</ContactChip>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-6">
          <HealthRing health={insight.health} size={64} r={25} stroke={5}>
            <span className="block text-center">
              <span className="block font-mono text-[15px] font-bold leading-none text-ws-text">
                {insight.health}
              </span>
              <span className="block font-mono text-[7px] tracking-[0.1em] text-ws-text-3">HEALTH</span>
            </span>
          </HealthRing>
          <Kpi label="LIFETIME VALUE" value={fmtGBP0(lifetimeValue)} />
          <Kpi label="VISITS" value={String(completedJobs.length)} />
          <Kpi label="ON ACCOUNT" value={openBalance > 0 ? fmtGBP(openBalance) : "£0"} />
        </div>
      </section>

      <CopilotBand brief={insight.brief} actions={insight.actions} />

      <div className="grid items-start gap-5 lg:grid-cols-[1.55fr_1fr]">
        {/* Left column */}
        <div className="flex min-w-0 flex-col gap-5">
          <section className={`${SECTION_CLASS} px-5 py-4`}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <SectionLabel>VEHICLES</SectionLabel>
              <Link
                href={`/staff/customers/${customer.id}/vehicles/new`}
                className="text-[12px] text-ws-text-2 underline underline-offset-2 hover:text-ws-text"
              >
                + Add vehicle
              </Link>
            </div>

            {vehicles.length === 0 ? (
              <p className="rounded-[10px] border border-dashed border-ws-border p-6 text-center text-sm text-ws-text-2">
                No vehicles on file for this customer yet.
              </p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {vehicles.map((v) => (
                  <div key={v.id} className="rounded-[10px] border border-ws-border bg-ws-page px-3.5 py-3">
                    <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-center gap-2.5">
                        <PlateChip reg={v.registration} size="md" />
                        <span className="text-sm font-semibold text-ws-text">
                          {[v.year, v.make, v.model].filter(Boolean).join(" ") || "—"}
                        </span>
                      </span>
                      <span className="flex flex-wrap gap-2.5 text-[12px]">
                        <Link
                          href={`/staff/bookings/new?customer=${customer.id}&vehicle=${v.id}`}
                          className="text-ws-text-2 underline underline-offset-2 hover:text-ws-text"
                        >
                          Book in
                        </Link>
                        <Link
                          href={`/staff/jobs?q=${encodeURIComponent(v.registration)}`}
                          className="text-ws-text-2 underline underline-offset-2 hover:text-ws-text"
                        >
                          History
                        </Link>
                        <Link
                          href={`/staff/customers/${customer.id}/vehicles/${v.id}/edit`}
                          className="text-ws-text-2 underline underline-offset-2 hover:text-ws-text"
                        >
                          Edit
                        </Link>
                        <DeleteVehicleButton vehicleId={v.id} customerId={customer.id} />
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <DuePill label="MOT" days={daysUntil(v.mot_expiry, now)} />
                      <DuePill label="SERVICE" days={daysUntil(v.service_due, now)} />
                      <DuePill label="TAX" days={daysUntil(v.tax_due_date, now)} />
                    </div>

                    <div className="mt-2.5 flex flex-wrap gap-2 border-t border-ws-border pt-2.5">
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
                    </div>
                  </div>
                ))}
              </div>
            )}

            <p className="mt-2.5 text-[11.5px] text-ws-text-3">
              Due pills: <span className="font-semibold text-ws-red">red</span> = 30 days or overdue,{" "}
              <span className="font-medium text-ws-amber">amber</span> = within 60 days. Reminders send to every
              channel on file (email + SMS + WhatsApp) and need a date plus contact details.
            </p>
          </section>

          <section id="activity" className={`${SECTION_CLASS} px-5 py-4`}>
            <SectionLabel className="mb-3.5">ACTIVITY</SectionLabel>
            {activityItems.length === 0 ? (
              <p className="text-sm text-ws-text-2">Nothing has happened on this record yet.</p>
            ) : (
              <div className="flex flex-col">
                {activityItems.map((item) => (
                  <div
                    key={item.key}
                    className="grid items-baseline gap-3 border-b border-ws-border/60 py-[7px]"
                    style={{ gridTemplateColumns: "14px 1fr auto" }}
                  >
                    <span className={`h-2 w-2 translate-y-px rounded-full ${DOT_CLASS[item.tone]}`} />
                    <span className="text-[13.5px] text-[#c8ccd2]">{item.text}</span>
                    <span className="whitespace-nowrap font-mono text-[10.5px] text-ws-text-3">
                      {fmtDay(item.at)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section id="compose" className={`${SECTION_CLASS} px-5 py-4`}>
            <SectionLabel className="mb-3">MESSAGE CUSTOMER</SectionLabel>
            <DraftMessagePanel
              customerId={customer.id}
              hasEmail={!!customer.email}
              hasPhone={!!customer.phone}
              initialTopic={draftTopic ?? null}
            />
          </section>

          {reminderItems.length > 0 && (
            <section className={`${SECTION_CLASS} px-5 py-4`}>
              <SectionLabel className="mb-2">REMINDER HISTORY</SectionLabel>
              <p className="mb-3 text-[11.5px] text-ws-text-3">
                One row per send. Expand to read the message per channel — the channel icon is green when it
                went out, red when it failed.
              </p>
              <ReminderHistory items={reminderItems} />
            </section>
          )}

          {pulses.length > 0 && (
            <section className={`${SECTION_CLASS} px-5 py-4`}>
              <SectionLabel className="mb-3">FEEDBACK</SectionLabel>
              <ul className="divide-y divide-ws-border">
                {pulses.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2.5 text-sm">
                    <span className="min-w-0">
                      <span
                        className={`font-semibold tabular-nums ${(p.score ?? 0) >= 4 ? "text-ws-green" : "text-ws-red"}`}
                      >
                        {p.score}★
                      </span>
                      {p.feedback_text && (
                        <span className="ml-2 text-ws-text-2">“{p.feedback_text.slice(0, 160)}”</span>
                      )}
                    </span>
                    <span className="flex flex-none items-center gap-2 text-xs text-ws-text-3">
                      {p.responded_at && fmtLongDate(p.responded_at)}
                      <Link href={`/staff/jobs/${p.job_id}`} className="underline underline-offset-2">
                        Job →
                      </Link>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <ServiceHistorySection entries={historyEntries} regByVehicleId={regByVehicleId} />

          <DeferredWorkPanel findings={deferredFindings} regByVehicleId={regByVehicleId} />

          {vehicles.length > 0 && (
            <StaffDiagnostic
              vehicles={vehicles.map((v) => ({
                id: v.id,
                registration: v.registration,
                make: v.make,
                model: v.model,
              }))}
            />
          )}

          <ImportedInvoicesSection invoices={importedInvoices} />
        </div>

        {/* Right rail */}
        <div className="flex min-w-0 flex-col gap-5">
          <section className={`${SECTION_CLASS} px-5 py-4`}>
            <AccountSection
              customerId={customer.id}
              initial={{
                accountCustomer: customer.account_customer,
                paymentTermsDays: customer.payment_terms_days,
                creditLimit: customer.credit_limit !== null ? Number(customer.credit_limit) : null,
                consolidatedBilling: customer.consolidated_billing,
              }}
              balance={customer.account_customer ? await accountBalance(admin, customer.id) : null}
              canManage={hasPermission(ctx, "invoices")}
            />
          </section>

          <section id="membership" className={`${SECTION_CLASS} px-5 py-4`}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <SectionLabel>MEMBERSHIP</SectionLabel>
              {liveMembership && (
                <span className="flex-none rounded-full border border-ws-green-border bg-ws-green-bg px-2.5 py-0.5 text-[11px] font-semibold text-ws-green">
                  ACTIVE
                </span>
              )}
            </div>
            <div className="flex flex-col gap-4">
              <MembershipsSection memberships={memberships} />
              {planOptions.length > 0 && (
                <PlanInvitePanel
                  customerId={customer.id}
                  plans={planOptions}
                  hasEmail={!!customer.email}
                  hasPhone={!!customer.phone}
                />
              )}
            </div>
          </section>

          <section className={`${SECTION_CLASS} px-5 py-4`}>
            <SectionLabel className="mb-3">COMPLIANCE</SectionLabel>
            <GdprPanel
              customerId={customer.id}
              customerName={customer.full_name ?? "this customer"}
              emailConsent={customer.marketing_email_consent}
              smsConsent={customer.marketing_sms_consent}
              consentUpdatedAt={customer.consent_updated_at}
              anonymizedAt={customer.anonymized_at}
              canErase={ctx.orgRole === "owner" || ctx.orgRole === "admin"}
              isOwner={ctx.orgRole === "owner"}
            />
          </section>
        </div>
      </div>
    </div>
  );
}

function ContactChip({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 overflow-hidden rounded-full border border-ws-border bg-ws-page px-2.5 py-[3px] text-[12px] text-ws-text-2">
      {icon}
      <span className="truncate">{children}</span>
    </span>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-ws-text-3">{label}</p>
      <p className="mt-0.5 text-[20px] font-bold tabular-nums text-[#fafafa]">{value}</p>
    </div>
  );
}
