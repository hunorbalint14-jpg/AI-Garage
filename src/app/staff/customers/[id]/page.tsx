import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { Button } from "@/components/ui/button";
import { ReminderButton } from "./reminder-button";
import { DeleteCustomerButton, DeleteVehicleButton } from "./delete-buttons";
import { DraftMessagePanel } from "./draft-message-panel";
import { StaffDiagnostic } from "./staff-diagnostic";
import { GdprPanel } from "./gdpr-panel";
import { ReminderHistory, type ReminderHistoryItem } from "./reminder-history";
import { PlanInvitePanel, type InvitePlanOption } from "./plan-invite-panel";
import { CustomerTabs } from "./customer-tabs";
import { MembershipsSection, type MembershipRow } from "./memberships-section";
import { subscriptionStatusLabel, isSubscriptionLive } from "@/lib/service-plans";
import { HomeGarageSelect } from "@/components/home-garage-select";
import { setCustomerHomeGarage } from "../actions";

type Customer = {
  id: string;
  organization_id: string;
  preferred_location_id: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  created_at: string;
  marketing_email_consent: boolean;
  marketing_sms_consent: boolean;
  consent_updated_at: string | null;
  anonymized_at: string | null;
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

  const [customerRes, vehiclesRes, remindersRes, plansRes, membershipsRes] = await Promise.all([
    admin
      .from("customers")
      .select("id, organization_id, preferred_location_id, full_name, email, phone, created_at, marketing_email_consent, marketing_sms_consent, consent_updated_at, anonymized_at")
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
  ]);

  // Tenant isolation: customers are org-global now, so the row must belong to
  // the staff member's ORGANISATION (any branch). Compares the admin-fetched
  // row against ctx.organization — the same RLS-independent pattern as the
  // job/booking detail pages.
  const customer = customerRes.data as Customer | null;
  if (!customer || customer.organization_id !== ctx.organization.id) notFound();

  const vehicles = (vehiclesRes.data ?? []) as Vehicle[];
  const reminders = (remindersRes.data ?? []) as Reminder[];
  const planOptions = (plansRes.data ?? []) as InvitePlanOption[];
  const memberships = (membershipsRes.data ?? []) as unknown as MembershipRow[];
  const liveMembership = memberships.find((m) => isSubscriptionLive(m.status)) ?? null;

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

      <CustomerTabs
        tabs={[
          {
            key: "overview",
            label: "Overview",
            content: (
              <div className="flex flex-col gap-6">
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
                    {ctx.accessibleLocations.length > 1 && (
                      <>
                        <dt className="text-muted-foreground">Home garage</dt>
                        <dd>
                          <HomeGarageSelect
                            branches={ctx.accessibleLocations.map((l) => ({ id: l.id, name: l.name }))}
                            currentId={customer.preferred_location_id}
                            action={setCustomerHomeGarage.bind(null, customer.id)}
                          />
                        </dd>
                      </>
                    )}
                  </dl>
                </section>

                <section className="rounded-lg border p-4">
                  <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
                    At a glance
                  </h2>
                  <dl className="grid grid-cols-[120px_1fr] gap-y-1 text-sm">
                    <dt className="text-muted-foreground">Vehicles</dt>
                    <dd>{vehicles.length}</dd>
                    <dt className="text-muted-foreground">Membership</dt>
                    <dd>
                      {liveMembership
                        ? `${liveMembership.service_plan?.name ?? "Plan"} · ${subscriptionStatusLabel(liveMembership.status)}`
                        : "None"}
                    </dd>
                    <dt className="text-muted-foreground">Marketing</dt>
                    <dd>
                      {[
                        customer.marketing_email_consent ? "Email" : null,
                        customer.marketing_sms_consent ? "SMS" : null,
                      ]
                        .filter(Boolean)
                        .join(" + ") || "Opted out"}
                    </dd>
                  </dl>
                </section>
              </div>
            ),
          },
          {
            key: "vehicles",
            label: "Vehicles",
            content: (
              <div className="flex flex-col gap-6">
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
                    <div className="overflow-x-auto rounded-lg border">
                      <table className="w-full min-w-[700px] text-sm">
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

                {vehicles.length > 0 && (
                  <StaffDiagnostic vehicles={vehicles.map((v) => ({ id: v.id, registration: v.registration, make: v.make, model: v.model }))} />
                )}
              </div>
            ),
          },
          {
            key: "memberships",
            label: "Memberships",
            content: (
              <div className="flex flex-col gap-6">
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
            ),
          },
          {
            key: "comms",
            label: "Comms",
            content: (
              <div className="flex flex-col gap-6">
                <DraftMessagePanel
                  customerId={customer.id}
                  hasEmail={!!customer.email}
                  hasPhone={!!customer.phone}
                />
                {reminderItems.length > 0 && (
                  <section className="flex flex-col gap-2">
                    <h2 className="text-lg font-semibold">Reminder history</h2>
                    <p className="text-xs text-muted-foreground">
                      Each row is one reminder send. Click to expand and see the message
                      body for each channel. Channel icons are green when sent
                      successfully, red on failure.
                    </p>
                    <ReminderHistory items={reminderItems} />
                  </section>
                )}
              </div>
            ),
          },
          {
            key: "compliance",
            label: "Compliance",
            content: (
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
            ),
          },
        ]}
      />
    </div>
  );
}
