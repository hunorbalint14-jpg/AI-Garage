// Source of truth for the end-to-end user manual (both portals).
//
// One entry per section drives BOTH:
//   - the Playwright capture (e2e/screenshots/capture.spec.ts) — `route`,
//     `persona`, `host`, and the optional `capture` hints say where to go and
//     what to shoot. Sections with `noShot: true` are concept pages (no UI to
//     capture) and are skipped by the capturer.
//   - the HTML assembler (scripts/build-help-doc.ts) — `title`, `purpose`,
//     `steps`/`prose`, `notes` become the body beside (or instead of) the shot.
//
// Adding a section is cheap: append one entry here, re-run `npm run help:gen`.

export type Persona = "public" | "customer" | "staff";

export type Section = {
  /** Stable slug — also the screenshot filename (`<portal>/<id>.png`) + the
   *  in-page anchor. Keep it kebab-case and unique within its part. */
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
  /** Numbered callouts for a UI section. Each becomes a badge beside the shot. */
  steps?: string[];
  /** Prose paragraphs for a concept section (`noShot`) — rendered full-width. */
  prose?: string[];
  /** Optional caveats / examples rendered as a highlighted note block. */
  notes?: string[];
  /** Concept page: no screenshot, full-width prose. Skipped by the capturer. */
  noShot?: boolean;
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

// ── Part 0 — How it works (concepts, no screenshots) ─────────────────────────
const concepts: Section[] = [
  {
    id: "overview",
    title: "How AI Garage fits together",
    persona: "public",
    route: "",
    noShot: true,
    purpose: "The big picture: one system, two front doors.",
    prose: [
      "AI Garage is a single platform with two sides. The staff portal is the garage's back office — bookings, the workshop job board, invoicing, customers and settings. The customer portal is what a vehicle owner sees: their vehicles, MOT and service due dates, quotes to approve, invoices to pay and any membership plan.",
      "The two sides share one database, so work flows through automatically. When a customer requests a booking, it lands on the garage's calendar. When the garage completes a job and raises an invoice, it appears in the customer's portal ready to pay. Nobody re-types anything.",
      "Each garage business is an 'organisation' and reaches its portal on its own web address (e.g. smith-motors.ai-garage.co.uk). An organisation can have several branches; staff switch their active branch from the top bar, while customers register once and are recognised at every branch.",
    ],
    notes: [
      "Rule of thumb: customers raise requests and approve/pay; staff do the work and the money. Everything a customer sees is produced by a staff action on the other side.",
    ],
  },
  {
    id: "lifecycle",
    title: "From booking to paid — the journey of a job",
    persona: "public",
    route: "",
    noShot: true,
    purpose: "The end-to-end flow every visit follows, with an example.",
    prose: [
      "1. Booking. A customer requests an appointment (or the garage books one in for them, or the AI receptionist takes the call). It shows on the calendar as 'scheduled'.",
      "2. Job. On the day, staff turn the booking into a 'job' on the workshop board and assign a bay and a mechanic. Parts and labour are added as line items as the work happens.",
      "3. Quote (if needed). If the mechanic finds extra work, they send the customer a quote — often with a photo or video. The customer approves or declines from their portal before that work goes ahead.",
      "4. Invoice. When the job is finished, staff raise an invoice from it. VAT, any plan discount and any membership credit are calculated automatically.",
      "5. Paid. The customer pays by card from their portal (or in person). The invoice flips to 'paid' and feeds the garage's revenue and reports.",
    ],
    notes: [
      "Example: Charlie books an MOT. The garage runs it, spots a worn brake disc, and sends a £140 quote with a photo. Charlie approves it on his phone. The garage fits the brakes, raises one invoice for the MOT + brakes, and Charlie pays by card — all without a phone call.",
    ],
  },
  {
    id: "payments",
    title: "Payments, deposits & finance",
    persona: "public",
    route: "",
    noShot: true,
    purpose: "How money moves — and who holds it.",
    prose: [
      "Card payments run through Stripe. Crucially, the garage is the 'merchant of record' — money goes directly into the garage's own connected Stripe account, never through AI Garage. AI Garage only takes a small platform fee on top. This keeps the garage in control of its takings, refunds and chargebacks.",
      "Deposits. A garage can require a deposit to approve a quote or hold a booking slot (set as a percentage in Settings). The deposit is taken up front and shown against the final invoice.",
      "No-show protection. For paid appointment types, the customer can save a card when booking; if they don't turn up, the garage can charge the agreed no-show fee.",
      "Spread the cost. On larger invoices the garage can offer regulated finance (e.g. Bumper) so the customer pays in instalments. The customer applies in a few taps from the invoice; the garage is still paid in full.",
    ],
    notes: [
      "Refunds are issued by the garage from its own Stripe account. AI Garage never holds customer funds, so a refund is always the garage's to make.",
    ],
  },
  {
    id: "memberships",
    title: "Membership plans & the 'funding gate'",
    persona: "public",
    route: "",
    noShot: true,
    purpose: "How prepaid service plans work — and why they're fair to both sides.",
    prose: [
      "A plan (e.g. 'Complete Care': one MOT + one service a year, plus 10% off everything else) is a prepayment, not credit. The customer pays monthly or annually, and the included services are drawn down as they're used.",
      "Included services are free at the point of booking only once the customer has paid in enough to cover them — the 'funding gate'. Until then, or once the period's allowance is used, the plan's everyday discount applies instead. This keeps the garage from ever being out of pocket and keeps the plan a simple prepayment in law.",
      "Onboarding. Covered services start 12 months after joining, unless the garage enrols the customer right after a full service + MOT — then they begin as soon as the plan is funded.",
      "Cancelling. A customer can cancel any time. They're refunded what they've paid in, minus any services already taken (charged at the normal walk-in price). They keep those services; nobody loses out. New plans also have a 14-day cooling-off period.",
    ],
    notes: [
      "Example: a member on 'Complete Care' books their included MOT. If their payments cover it, they pay £0 and the allowance shows 'MOT 0 of 1 left'. A second MOT in the same year falls back to the 10% member price.",
    ],
  },
  {
    id: "signs",
    title: "Badges & signs — what they mean",
    persona: "public",
    route: "",
    noShot: true,
    purpose: "A quick key to the colours and symbols across the app.",
    prose: [
      "Due-date badges (vehicles). Green = fine. Amber = due soon (roughly within 30–60 days). Red = due now or overdue. They appear on MOT, service and road-tax dates so the most urgent vehicle stands out at a glance.",
      "The EV / high-voltage sign (⚡). On a job, a lightning/high-voltage flag means the vehicle is electric or hybrid with dangerous high-voltage systems. Only mechanics with a valid EV (SERMI) qualification should work on it — the garage tracks who's qualified, and their certificate expiry, in Settings. It's a safety flag, not a service type.",
      "Booking & job statuses. Bookings move scheduled → in progress → complete (or cancelled / no-show). Jobs move open → completed → invoiced. Quotes move sent → viewed → approved / declined / expired. Invoices move draft → sent → paid (or overdue).",
      "Coverage labels (member booking). 'Included in your plan' means £0 to pay; 'member price' means the plan discount has been applied to the amount shown.",
    ],
  },
  {
    id: "integrations",
    title: "Integrations — what plugs in",
    persona: "public",
    route: "",
    noShot: true,
    purpose: "The outside services the garage can connect, and what each does.",
    prose: [
      "Stripe — card payments, deposits and payouts, straight into the garage's own account (see Payments).",
      "Xero — accounting. Connect once and invoices/payments sync across so the books stay tidy without double entry.",
      "DVLA & DVSA — UK vehicle data. Enter a registration and the make/model, MOT history and recalls are pulled in automatically; MOT due dates are kept fresh.",
      "Twilio — SMS and WhatsApp for reminders, booking confirmations and the AI receptionist's text replies.",
      "Email (Resend) — transactional email: quotes, invoices, reminders and review requests.",
      "Passkeys — modern, phishing-resistant sign-in (Face ID / fingerprint / security key) for staff and customers, instead of passwords.",
    ],
    notes: [
      "Integrations are optional and set up in staff Settings → Integrations. The app works without them; connecting each one removes manual work (e.g. no re-keying invoices into Xero).",
    ],
  },
];

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
    purpose: "Get back into your portal — by a one-tap email link or your password.",
    steps: [
      "Choose 'Email link' to be sent a secure one-time sign-in link (nothing to remember), or 'Password' if you've set one.",
      "Enter your email (and password if using that tab).",
      "Open the email link on the same device, or press 'Sign in', to land on your dashboard.",
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
      "'Action needed' flags a vehicle with something overdue so it stands out.",
      "Use 'Book an appointment' to start a booking already filled in with your details.",
      "Upcoming bookings and recent invoices sit below; tap any to open it.",
    ],
    notes: ["See 'Badges & signs' in How it works for exactly what the colours mean."],
  },
  {
    id: "mot-history",
    title: "MOT history",
    persona: "customer",
    route: "/dashboard",
    capture: { clickToDetail: "a[href*='/dashboard/mot/']" },
    purpose: "The full official DVSA MOT test history for a vehicle, including past advisories.",
    steps: [
      "Open a vehicle's MOT history from its dashboard card ('View full MOT history').",
      "Each past test shows pass or fail, the mileage, and any advisory or failure items.",
      "Use it to spot recurring advisories — they often become failures the following year — then 'Book an appointment' to get them sorted.",
    ],
    notes: ["This is the same data as gov.uk, kept next to the booking button so you can act on it."],
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
      "If the service is covered by your plan you'll see a green 'Included in your plan' note and pay nothing; otherwise any deposit or fee is shown before you confirm.",
      "Submit the request — the garage confirms the slot and you get a notification.",
    ],
    notes: ["'Pay now to confirm' appears only when the service has a price and the garage takes card payments. Covered plan services skip payment entirely."],
  },
  {
    id: "quotes",
    title: "Quotes",
    persona: "customer",
    route: "/dashboard/quotes",
    purpose: "Extra work the garage has recommended, waiting for your decision.",
    steps: [
      "Quotes awaiting your response sit at the top; approved or declined ones move to history.",
      "Open a quote to see the line items, any inspection photo or video, and the total.",
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
      "Approve & authorise the work, or decline it.",
      "If a deposit is required, pay it securely here to lock in the booking.",
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
      "Press 'Pay now' to pay securely by card.",
      "Use 'Spread the cost' to apply for finance where the garage offers it and the amount qualifies.",
      "Print or save a PDF copy for your records.",
    ],
    notes: ["Membership credits and plan discounts are applied automatically before you pay — you never need to enter a code."],
  },
  {
    id: "plans",
    title: "Plans & membership",
    persona: "customer",
    route: "/dashboard/plans",
    purpose: "Manage your service plan — what's included, what's left this period, and how to cancel.",
    steps: [
      "Active plans show the included services and how many of each you have left this period (e.g. 'MOT 0 of 1 left').",
      "Available plans can be subscribed monthly or annually.",
      "'Cancel plan' stops the plan immediately and refunds your unspent balance.",
    ],
    notes: [
      "How included services work is explained fully under 'Membership plans & the funding gate' in How it works — in short: a covered service is free once your payments cover it; otherwise the member discount applies.",
      "Cancelling refunds what you've paid in, minus any services already taken at the normal walk-in price. New plans have a 14-day cooling-off period.",
    ],
  },
  {
    id: "settings",
    title: "Settings",
    persona: "customer",
    route: "/dashboard/settings",
    purpose: "Your contact preferences and home garage.",
    steps: [
      "Toggle marketing email and SMS consent — essential service reminders are sent regardless.",
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
      "Tiles track this week's revenue, customers, vehicles, open jobs, pending invoices and overdue amounts.",
      "The day schedule shows each bay's bookings; use 'New booking' to add one.",
      "Switch your active branch from the top-bar selector — every figure re-scopes to it.",
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
      "Create a new booking with 'New booking'. Turning a booking into a job moves it to the workshop board.",
    ],
  },
  {
    id: "jobs",
    title: "Jobs",
    persona: "staff",
    route: "/staff/jobs",
    purpose: "The workshop board — every job by stage: open, completed, invoiced.",
    steps: [
      "Cards show the vehicle, customer, assignee and a high-voltage (⚡ EV) flag where it applies.",
      "Open a job to add parts and labour, record work and mark it complete.",
      "Completed jobs flow through to invoicing in one step.",
    ],
    notes: ["The ⚡ flag means an electric/hybrid vehicle with high-voltage systems — only EV-qualified mechanics should work on it (see 'Badges & signs')."],
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
      "Overview shows contact details and marketing consent.",
      "The Memberships tab lists plans; staff can bring plan benefits forward when a customer enrols right after a service + MOT.",
      "Reminder history records every MOT/service nudge sent and whether it was delivered.",
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
      "Totals by status sit across the top so you can see what's outstanding.",
      "Open an invoice to send it, record a payment or issue a refund.",
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
      "Create a new quote, attach a photo or video, and send it for approval.",
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
      "The trend chart plots monthly revenue; org roles can view all branches or just one.",
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
      "Review the VAT summary and aged-debtor buckets (current, 1–30, 31–60, 60+ days).",
      "Productivity and utilisation break billable hours down by mechanic.",
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
      "Stock at or below the reorder level flags items to order.",
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
      "Add an everyday member discount that applies once the included allowance is used.",
      "Active subscriptions per plan are shown; prices sync to Stripe.",
    ],
    notes: ["Included services follow the prepayment funding gate — see 'Membership plans & the funding gate' in How it works."],
  },
  {
    id: "reminders",
    title: "Reminders",
    persona: "staff",
    route: "/staff/reminders",
    purpose: "Send MOT, service and tax reminders to customers.",
    steps: [
      "Vehicles due in the next 60 days are listed.",
      "Compose and send a reminder by email, SMS or push; the history shows delivery status.",
    ],
    notes: ["Most reminders also go out automatically — this page is for sending one by hand. See Automations to schedule them."],
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
      "Integrations: connect Stripe and Xero, set the deposit % and quote validity.",
      "Compliance: accept the Data Processing Agreement and set MFA enforcement.",
    ],
    notes: ["Owners and admins only. Some actions (managing the team, GDPR) stay locked to owner/admin even when other permissions are granted."],
  },
  {
    id: "staff-members",
    title: "Team & roles",
    persona: "staff",
    route: "/staff/staff-members",
    purpose: "Invite teammates and control what each can see and do.",
    steps: [
      "Invite staff by email and set an org role (owner, admin, accountant) or a per-branch role.",
      "Grant permissions by group — operational, financial, quotes, catalogue, sensitive, MOT.",
      "Flag MOT testers / QC reviewers and EV (SERMI) certification where relevant.",
    ],
    notes: ["Accountant is an org-wide, finance-read-only role — handy for a bookkeeper who shouldn't touch operations."],
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
      name: "How it works",
      blurb: "Start here — the concepts behind the screens.",
      sections: concepts,
    },
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

const portalOf = (partName: string): string =>
  partName === "Customer guide" ? "customer" : partName === "Staff guide" ? "staff" : "concept";

/** Flat list of (portal, section) for the builder. */
export function allSections(): { portal: string; section: Section }[] {
  return MANUAL.parts.flatMap((p) =>
    p.sections.map((section) => ({ portal: portalOf(p.name), section })),
  );
}

/** Only the sections that have a UI to screenshot (used by the capturer). */
export function shotSections(): { portal: string; section: Section }[] {
  return allSections().filter(({ section }) => !section.noShot);
}
