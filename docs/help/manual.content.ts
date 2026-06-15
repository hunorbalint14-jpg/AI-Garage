// Source of truth for the end-to-end user manual (both portals).
//
// One entry per section drives BOTH:
//   - the Playwright capture (e2e/screenshots/capture.spec.ts) — `route`,
//     `persona`, `host`, and the optional `capture` hints say where to go and
//     what to shoot;
//   - the HTML assembler (scripts/build-help-doc.ts) — `title`, `purpose`,
//     `steps`, `notes` become the numbered callouts beside the screenshot.
//
// Adding a section is cheap: append one entry here, re-run `npm run help:gen`.

export type Persona = "public" | "customer" | "staff";

export type Section = {
  /** Stable slug — also the screenshot filename (`<portal>/<id>.png`) + the
   *  in-page anchor. Keep it kebab-case and unique. */
  id: string;
  title: string;
  /** Which signed-in identity Playwright should use to reach the page. */
  persona: Persona;
  /** Path under the host. Dynamic detail pages use `capture.clickToDetail`
   *  from a listing route instead of a hard-coded id. */
  route: string;
  /** Tenant subdomain (default) or the root/apex host. */
  host?: "tenant" | "root";
  /** One-line "what this is for", shown under the section title. */
  purpose: string;
  /** Numbered callouts. Each becomes a badge (1,2,3…) beside the screenshot. */
  steps: string[];
  /** Optional caveats / edge cases rendered as a note block. */
  notes?: string[];
  capture?: {
    /** Selector to wait for before shooting (content settled). */
    waitFor?: string;
    /** Click this from `route` to reach a detail page, then shoot that. */
    clickToDetail?: string;
    /** Full-page vs viewport. Default viewport (above the fold reads best). */
    fullPage?: boolean;
  };
};

export type Part = { name: string; blurb: string; sections: Section[] };
export type Manual = { title: string; subtitle: string; parts: Part[] };

// ── Part 1 — Customer guide ──────────────────────────────────────────────────
const customer: Section[] = [
  {
    id: "register",
    title: "Create your account",
    persona: "public",
    route: "/register",
    purpose: "Register once with your garage to track your vehicles, bookings and invoices in one place.",
    steps: [
      "Enter your full name, email and mobile number.",
      "Pick your home garage — the branch you usually visit (skipped if the garage has a single location).",
      "Agree to the garage's privacy policy, then submit. You'll be signed in straight away.",
    ],
    notes: ["One account covers every branch of the same garage group — you don't register twice."],
  },
  {
    id: "login",
    title: "Sign in",
    persona: "public",
    route: "/login",
    purpose: "Return to your portal with a one-tap secure link sent to your email.",
    steps: [
      "Type the email you registered with.",
      "Press 'Send link' — we email you a secure sign-in link (no password to remember).",
      "Open the link on the same device to land back on your dashboard.",
    ],
  },
  {
    id: "dashboard",
    title: "Your dashboard",
    persona: "customer",
    route: "/dashboard",
    purpose: "Your home screen: every vehicle with its MOT, service and tax status, plus upcoming visits.",
    steps: [
      "Each vehicle card shows MOT, service and tax due dates with a colour cue — green (fine), amber (due soon), red (due now or overdue).",
      "Use 'Book an appointment' to start a new booking pre-filled with your details.",
      "Upcoming bookings and recent invoices are listed below; tap any to open it.",
      "The AI assistant panel can answer quick questions about a warning light or noise.",
    ],
  },
  {
    id: "mot-history",
    title: "MOT history",
    persona: "customer",
    route: "/dashboard",
    capture: { clickToDetail: "a[href*='/dashboard/mot/']" },
    purpose: "The full official DVLA MOT test history for a vehicle, including advisories.",
    steps: [
      "Open a vehicle's MOT history from its dashboard card.",
      "Each past test shows the result (pass/fail), mileage and any advisory or failure items.",
      "Use this to spot recurring advisories before they become failures.",
    ],
  },
  {
    id: "book",
    title: "Book an appointment",
    persona: "customer",
    route: "/dashboard/book",
    purpose: "Request a visit: choose branch, service, vehicle and a preferred time.",
    steps: [
      "Pick the branch (if the garage has more than one) and the service you need.",
      "Choose the vehicle and a preferred date and time.",
      "If the service is covered by your plan you'll see 'Included in your plan' and pay nothing; otherwise any deposit or fee is shown before you confirm.",
      "Submit the request — the garage confirms the slot and you get a notification.",
    ],
    notes: ["A green 'Included in your {plan}' banner means no payment is taken — see Plans & membership."],
  },
  {
    id: "quotes",
    title: "Quotes",
    persona: "customer",
    route: "/dashboard/quotes",
    purpose: "Work the garage has recommended, waiting for your decision.",
    steps: [
      "Quotes awaiting your response sit at the top; approved/declined ones move to history.",
      "Open a quote to see the line items, any inspection video and the total.",
      "Approve to authorise the work, decline if you don't want it, or rebook to pick a new slot.",
    ],
  },
  {
    id: "quote-detail",
    title: "Reviewing a quote",
    persona: "customer",
    route: "/dashboard/quotes",
    capture: { clickToDetail: "a[href*='/dashboard/quotes/']" },
    purpose: "The detail of a single quote, with everything you need to decide.",
    steps: [
      "Review each recommended item and its price; watch the inspection video if one is attached.",
      "Approve & authorise the work, or Decline.",
      "If a deposit is required, pay it securely here to lock the booking.",
    ],
  },
  {
    id: "history",
    title: "Service history",
    persona: "customer",
    route: "/dashboard/history",
    purpose: "A record of completed work across all your vehicles.",
    steps: [
      "Jobs are grouped by vehicle, newest first.",
      "Open any job to see the line items, related quotes and any tyre-check results.",
    ],
  },
  {
    id: "documents",
    title: "Documents",
    persona: "customer",
    route: "/dashboard/documents",
    purpose: "One place for your invoices, inspection reports, service records and MOT links.",
    steps: [
      "Invoices, inspection reports (DVIs) and service records are grouped by type.",
      "Open an invoice to view or pay it; open a report to read the inspection findings.",
      "MOT history links jump straight to the official gov.uk record.",
    ],
  },
  {
    id: "invoice",
    title: "Invoices & paying",
    persona: "customer",
    route: "/dashboard/documents",
    capture: { clickToDetail: "a[href*='/invoice/']" },
    purpose: "View an invoice in full and pay it by card.",
    steps: [
      "Line items, VAT and any membership credit or discount are itemised; savings show in green.",
      "Press 'Pay now' to pay securely by card via Stripe.",
      "Use 'Spread the cost' to apply for finance where the garage offers it and the amount qualifies.",
      "Print or save a PDF copy for your records.",
    ],
    notes: ["Membership credits and plan discounts are applied automatically before you pay."],
  },
  {
    id: "plans",
    title: "Plans & membership",
    persona: "customer",
    route: "/dashboard/plans",
    purpose: "Manage your service plan — what's included, what's left this period, and how to cancel.",
    steps: [
      "Active plans show the included services and how many of each you have left this period.",
      "Available plans can be subscribed monthly or annually.",
      "'Cancel plan' stops the plan immediately and refunds your unspent balance (see notes).",
    ],
    notes: [
      "How included services work: a covered service is free once your payments-in cover it (the 'funding gate'). Until then — or once you've used your allowance for the period — the plan's member discount applies instead of £0.",
      "Onboarding: covered services begin 12 months after you join, unless the garage enrols you right after a full service + MOT (then they start once funded).",
      "Cancelling: you can cancel any time. We refund what you've paid in, minus any services you've already taken (charged at the normal walk-in price). You keep those services; you're never left out of pocket and neither is the garage. A 14-day cooling-off applies to new plans.",
    ],
  },
  {
    id: "settings",
    title: "Settings",
    persona: "customer",
    route: "/dashboard/settings",
    purpose: "Your contact preferences and home garage.",
    steps: [
      "Toggle marketing email and SMS consent — service reminders are sent regardless.",
      "Change your home garage (the branch you usually visit) if the garage has multiple locations.",
    ],
  },
];

// ── Part 2 — Staff guide (garage employees) ─────────────────────────────────
const staff: Section[] = [
  {
    id: "login",
    title: "Staff sign-in",
    persona: "public",
    route: "/staff/login",
    purpose: "Sign in to the garage's back office. Owners and admins use multi-factor (passkey) sign-in.",
    steps: [
      "Enter your work email and password.",
      "If prompted, complete passkey verification (Face ID / fingerprint / security key).",
      "You land on the dashboard for your active branch.",
    ],
  },
  {
    id: "dashboard",
    title: "Staff dashboard",
    persona: "staff",
    route: "/staff",
    purpose: "Today at a glance: schedule, vehicles needing attention, open work and key numbers.",
    steps: [
      "Today's bookings are laid out by bay and time.",
      "'Needs attention' surfaces vehicles with expiring MOTs or due services.",
      "Tiles track open jobs, uninvoiced work, pending invoices and quotes, and this week's revenue.",
      "Use the branch switcher in the top bar to change your active location.",
    ],
  },
  {
    id: "bookings",
    title: "Bookings",
    persona: "staff",
    route: "/staff/bookings",
    purpose: "Manage appointments in calendar or list view.",
    steps: [
      "Switch between month, day and list views; filter by status or assignee.",
      "Open a booking to assign a staff member and bay, confirm with the customer, or reschedule.",
      "Create a new booking with 'New booking'.",
    ],
  },
  {
    id: "jobs",
    title: "Jobs",
    persona: "staff",
    route: "/staff/jobs",
    purpose: "The workshop board — every job by stage: open, completed, invoiced.",
    steps: [
      "Cards show the vehicle, customer, assignee and any high-voltage (EV) flag.",
      "Open a job to update items, record work and mark it complete.",
      "Completed jobs flow through to invoicing.",
    ],
  },
  {
    id: "customers",
    title: "Customers",
    persona: "staff",
    route: "/staff/customers",
    purpose: "The customer directory, searchable across the whole organisation.",
    steps: [
      "Search by name, email or phone; results paginate.",
      "Open a customer to see vehicles, reminders, memberships and GDPR tools.",
      "Add a new customer with 'New customer'.",
    ],
  },
  {
    id: "customer-detail",
    title: "Customer detail",
    persona: "staff",
    route: "/staff/customers",
    capture: { clickToDetail: "a[href*='/staff/customers/']" },
    purpose: "Everything about one customer across tabs: overview, vehicles, reminders, memberships.",
    steps: [
      "Overview shows contact details and consent.",
      "The Memberships tab lists plans; staff can bring plan benefits forward when a customer enrols right after a service + MOT.",
      "Reminder history records every MOT/service nudge sent and its delivery status.",
    ],
  },
  {
    id: "invoices",
    title: "Invoices",
    persona: "staff",
    route: "/staff/invoices",
    purpose: "The invoice register with status totals and search.",
    steps: [
      "Filter by status — draft, sent, paid, overdue — or search by customer or number.",
      "Totals by status sit across the top.",
      "Open an invoice to send, record payment or refund.",
    ],
  },
  {
    id: "quotes",
    title: "Quotes",
    persona: "staff",
    route: "/staff/quotes",
    purpose: "Job and standalone quotes through their whole lifecycle.",
    steps: [
      "Filter by status (draft, pending, approved, declined, expired) or search.",
      "Track which quotes the customer has viewed and responded to.",
      "Create a new quote with the action button.",
    ],
  },
  {
    id: "revenue",
    title: "Revenue",
    persona: "staff",
    route: "/staff/revenue",
    purpose: "Cash-flow at a glance with a monthly trend.",
    steps: [
      "See this month's revenue, year-to-date, paid, outstanding and overdue.",
      "The trend chart plots monthly revenue; org roles can view all locations or one branch.",
    ],
  },
  {
    id: "reports",
    title: "Reports",
    persona: "staff",
    route: "/staff/reports",
    purpose: "Analytics: VAT, aged debt, labour productivity and bay utilisation.",
    steps: [
      "Pick a period — this month, year-to-date or a custom range.",
      "Review the VAT summary and aged-debtor buckets.",
      "Productivity and utilisation break down billable hours by mechanic.",
    ],
  },
  {
    id: "services",
    title: "Services",
    persona: "staff",
    route: "/staff/services",
    purpose: "Your service catalogue and pricing.",
    steps: [
      "Services are grouped by category (MOT, servicing, brakes, tyres…).",
      "Add a service or edit its price, duration, VAT treatment and active flag.",
    ],
  },
  {
    id: "products",
    title: "Products",
    persona: "staff",
    route: "/staff/products",
    purpose: "Parts inventory with stock levels and reorder points.",
    steps: [
      "Edit name, SKU, cost and unit price, stock quantity and reorder level inline.",
      "Low stock against the reorder level flags items to order.",
    ],
  },
  {
    id: "plans",
    title: "Service plans",
    persona: "staff",
    route: "/staff/plans",
    purpose: "Create and manage membership plans (e.g. MOT + service every 12 months).",
    steps: [
      "Set the plan name, monthly/annual price and included items (service + quantity per period).",
      "Active subscriptions per plan are shown; prices sync to Stripe.",
    ],
    notes: ["Included services follow the prepayment funding gate — see the customer 'Plans & membership' section."],
  },
  {
    id: "reminders",
    title: "Reminders",
    persona: "staff",
    route: "/staff/reminders",
    purpose: "Send MOT, service and tax reminders to customers.",
    steps: [
      "Vehicles due in the next 60 days are listed.",
      "Compose and send a reminder by email, SMS or push; sent history shows delivery status.",
    ],
  },
  {
    id: "settings",
    title: "Settings",
    persona: "staff",
    route: "/staff/settings",
    purpose: "Organisation configuration: branding, locations, team, integrations and compliance.",
    steps: [
      "Business: logo, brand colour, opening hours and contact details.",
      "Locations: add branches and set the primary location.",
      "Integrations: connect Stripe and Xero, set deposit % and quote validity.",
      "Compliance: DPA acceptance and MFA enforcement.",
    ],
    notes: ["Owners and admins only. Some actions (team, GDPR) are locked to owner/admin even with other permissions."],
  },
  {
    id: "staff-members",
    title: "Team & roles",
    persona: "staff",
    route: "/staff/staff-members",
    purpose: "Invite teammates and control what each can see and do.",
    steps: [
      "Invite staff by email and set an org role (owner, admin, accountant) or a per-branch role.",
      "Grant location permissions by group — operational, financial, quotes, catalogue, sensitive, MOT.",
      "Flag MOT testers/QC reviewers and EV certification where relevant.",
    ],
  },
  {
    id: "audit-log",
    title: "Audit log",
    persona: "staff",
    route: "/staff/audit-log",
    purpose: "An append-only trail of staff actions for GDPR and finance compliance.",
    steps: [
      "Filter by action group (GDPR, financial, quotes, integrations, auth), actor or action.",
      "Each row records who did what, when, and from where.",
    ],
  },
  {
    id: "docs",
    title: "Doc shares (this manual)",
    persona: "staff",
    route: "/staff/docs",
    purpose: "Mint a private, signed link to this manual to hand to staff or customers.",
    steps: [
      "Pick 'User manual', an expiry and an optional view cap, then 'Mint share link'.",
      "Copy the link once — the token is shown a single time and stored only as a hash.",
      "Revoke a link any time; revoked links return a 'Link revoked' page.",
    ],
  },
];

export const MANUAL: Manual = {
  title: "AI Garage — User Manual",
  subtitle: "An end-to-end guide to the customer portal and the staff back office.",
  parts: [
    {
      name: "Customer guide",
      blurb: "For vehicle owners using the garage's online portal.",
      sections: customer,
    },
    {
      name: "Staff guide",
      blurb: "For garage employees running the back office.",
      sections: staff,
    },
  ],
};

/** Flat list of (portal, section) for capture + image lookup. */
export function allSections(): { portal: string; section: Section }[] {
  return MANUAL.parts.flatMap((p) => {
    const portal = p.name === "Customer guide" ? "customer" : "staff";
    return p.sections.map((section) => ({ portal, section }));
  });
}
