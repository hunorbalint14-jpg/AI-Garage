import { createAdminClient } from "@/lib/supabase/admin";
import type { StaffContext } from "@/lib/staff-context";

// Setup checklist (#506 PR 2). Every step is DERIVED from real data — nothing
// is manually ticked, so the card self-completes and can never lie. Optional
// steps never block 100%.

type Admin = ReturnType<typeof createAdminClient>;

export type ChecklistState = {
  hoursSet: boolean;
  activeServices: number;
  bays: number;
  teamSize: number; // distinct users across org + branch grants
  stripeChargesEnabled: boolean;
  logoSet: boolean;
  xeroConnected: boolean;
  customers: number;
};

export type ChecklistStep = {
  key: string;
  label: string;
  detail: string;
  done: boolean;
  optional?: boolean;
  /** Deep link to complete the step; null renders without one (e.g. the live booking page shows a copy control instead). */
  href: string | null;
  /** The question the "ask AI" affordance primes the support assistant with. */
  ask: string;
};

export type SetupChecklist = {
  steps: ChecklistStep[];
  /** Required steps done / required steps total. */
  done: number;
  total: number;
  complete: boolean;
  bookingUrl: string;
  bookingLive: boolean;
};

export function buildChecklist(state: ChecklistState, bookingUrl: string): SetupChecklist {
  const bookingLive = state.hoursSet && state.activeServices > 0;
  const steps: ChecklistStep[] = [
    {
      key: "hours",
      label: "Set your opening hours",
      detail: "Bookings and reminders respect them.",
      done: state.hoursSet,
      href: "/staff/settings?tab=booking",
      ask: "How do I set my garage's opening hours, and how do special dates like bank holidays work?",
    },
    {
      key: "services",
      label: "Add services & prices",
      detail: "What customers can book, and what it costs.",
      done: state.activeServices > 0,
      href: "/staff/services",
      ask: "How do I add the services my garage offers and set their prices and durations?",
    },
    {
      key: "bays",
      label: "Add your workshop bays",
      detail: "Capacity drives the schedule.",
      done: state.bays > 0,
      href: "/staff/bays",
      ask: "What are bays used for and how do I set mine up?",
    },
    {
      key: "team",
      label: "Invite your team",
      detail: "Technicians, front desk, your accountant.",
      done: state.teamSize > 1,
      href: "/staff/staff-members",
      ask: "How do I invite my staff and what do the roles and permissions mean?",
    },
    {
      key: "stripe",
      label: "Get paid online",
      detail: "Connect Stripe for card payments and deposits.",
      done: state.stripeChargesEnabled,
      href: "/staff/settings?tab=payments",
      ask: "How do I connect Stripe so customers can pay invoices and deposits online?",
    },
    {
      key: "logo",
      label: "Add your logo",
      detail: "Brands your booking page, emails and invoices.",
      done: state.logoSet,
      href: "/staff/settings?tab=business",
      ask: "How do I upload my garage's logo and where does it appear?",
    },
    {
      key: "booking",
      label: "Your booking page is live",
      detail: "Put the link on Facebook and your Google Business Profile.",
      done: bookingLive,
      href: null,
      ask: "Where should I share my online booking page link to get the most bookings?",
    },
    {
      key: "customer",
      label: "Add your first customer",
      detail: "Or import your existing book.",
      done: state.customers > 0,
      href: "/staff/customers/new",
      ask: "How do I add customers, and can I import my existing customer list?",
    },
    {
      key: "xero",
      label: "Connect accounting",
      detail: "Xero sync for invoices — optional.",
      done: state.xeroConnected,
      optional: true,
      href: "/staff/settings?tab=integrations",
      ask: "How does the Xero integration work and what gets synced?",
    },
  ];

  const required = steps.filter((s) => !s.optional);
  const done = required.filter((s) => s.done).length;
  return {
    steps,
    done,
    total: required.length,
    complete: done === required.length,
    bookingUrl,
    bookingLive,
  };
}

export function tenantBookingUrl(tenantSlug: string): string {
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "ai-garage.co.uk";
  const isLocal = rootDomain.includes("localtest") || rootDomain.includes("localhost");
  const proto = isLocal ? "http" : "https";
  return `${proto}://${tenantSlug}.${rootDomain}/book`;
}

// Null = don't render: dismissed, or every required step already done. The
// dismissal short-circuit runs before any counting so established orgs pay
// one indexed column read, not eight counts, per dashboard render.
export async function loadSetupChecklist(admin: Admin, ctx: StaffContext): Promise<SetupChecklist | null> {
  const { data: orgRow } = await admin
    .from("organizations")
    .select("setup_checklist_dismissed_at, stripe_account_id, stripe_charges_enabled, logo_url, xero_connected_at")
    .eq("id", ctx.organization.id)
    .maybeSingle();
  const org = orgRow as {
    setup_checklist_dismissed_at: string | null;
    stripe_account_id: string | null;
    stripe_charges_enabled: boolean | null;
    logo_url: string | null;
    xero_connected_at: string | null;
  } | null;
  if (!org || org.setup_checklist_dismissed_at) return null;

  const [locRes, servicesRes, baysRes, customersRes, orgUsersRes, locUsersRes] = await Promise.all([
    admin.from("locations").select("id, business_hours").eq("id", ctx.location.id).maybeSingle(),
    admin.from("services").select("id", { count: "exact", head: true }).eq("location_id", ctx.location.id).eq("active", true),
    admin.from("bays").select("id", { count: "exact", head: true }).eq("location_id", ctx.location.id),
    admin.from("customers").select("id", { count: "exact", head: true }).eq("organization_id", ctx.organization.id),
    admin.from("org_users").select("user_id").eq("organization_id", ctx.organization.id),
    admin
      .from("location_users")
      .select("user_id, location:locations!inner(organization_id)")
      .eq("location.organization_id", ctx.organization.id),
  ]);

  const team = new Set<string>([
    ...((orgUsersRes.data ?? []) as { user_id: string }[]).map((r) => r.user_id),
    ...((locUsersRes.data ?? []) as { user_id: string }[]).map((r) => r.user_id),
  ]);

  const state: ChecklistState = {
    hoursSet: !!(locRes.data as { business_hours: unknown } | null)?.business_hours,
    activeServices: servicesRes.count ?? 0,
    bays: baysRes.count ?? 0,
    teamSize: team.size,
    stripeChargesEnabled: !!org.stripe_account_id && !!org.stripe_charges_enabled,
    logoSet: !!org.logo_url,
    xeroConnected: !!org.xero_connected_at,
    customers: customersRes.count ?? 0,
  };

  const checklist = buildChecklist(state, tenantBookingUrl(ctx.organization.slug));
  return checklist.complete ? null : checklist;
}
