// Source of truth for the end-to-end user manual (both portals).
//
// One entry per section drives BOTH:
//   - the Playwright capture (e2e/screenshots/capture.spec.ts) — `route`,
//     `persona`, `host`, and the optional `capture` hints say where to go and
//     what to shoot. Sections with `noShot: true` are concept pages (no UI to
//     capture) and are skipped by the capturer. `stepper` entries request
//     extra state shots (`<portal>/<id>--<n>.png`) via the ACTIONS registry in
//     the capture spec; `video` marks a section whose flow is recorded by
//     e2e/screenshots/video.spec.ts into docs/internal/help-videos/.
//   - the HTML assembler (scripts/build-help-doc.ts) — `title`, `purpose`,
//     `steps`/`prose`, `notes`, `roles`, `troubleshooting`, `diagram`,
//     `stepper`, `video` become the body beside (or instead of) the shot.
//
// Adding a section is cheap: append one entry here, re-run `npm run help:gen`.

export type Persona = "public" | "customer" | "staff";

export type Troubleshoot = {
  /** The symptom, as the user would describe it. */
  problem: string;
  /** What to check / do. */
  fix: string;
};

export type StepperStep = {
  /** Caption under the shot for this step. Screenshot file is
   *  `<portal>/<id>--<index+1>.png`, produced by the capture ACTIONS registry. */
  caption: string;
};

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
  /** Who can see this page — rendered as a badge. Omit for "All staff" on
   *  staff sections / everyone elsewhere. */
  roles?: string;
  /** Numbered callouts for a UI section. Each becomes a badge beside the shot. */
  steps?: string[];
  /** Prose paragraphs for a concept section (`noShot`) — rendered full-width. */
  prose?: string[];
  /** Optional caveats / examples rendered as a highlighted note block. */
  notes?: string[];
  /** "If X isn't working…" box. */
  troubleshooting?: Troubleshoot[];
  /** Concept page: no screenshot, full-width prose. Skipped by the capturer. */
  noShot?: boolean;
  /** Built-in animated diagram (concepts): rendered by the builder. */
  diagram?: "lifecycle" | "funding" | "comms" | "org";
  /** Interactive stepper: click-through states. Shots come from the capture
   *  ACTIONS registry (one action per section id producing --1, --2, …). */
  stepper?: StepperStep[];
  /** Screen recording (docs/internal/help-videos/<portal>/<id>.webm),
   *  produced by video.spec.ts. */
  video?: { caption: string };
  capture?: {
    /** Selector to wait for before shooting (content settled). */
    waitFor?: string;
    /** Click this from `route` to reach a detail page, then shoot that. */
    clickToDetail?: string;
    /** Click these in order (for two-hop drills, e.g. documents → invoice). */
    clickSequence?: string[];
    /** Full-page vs viewport. Default viewport (above the fold reads best). */
    fullPage?: boolean;
  };
};

export type Faq = { q: string; a: string };
export type Part = { name: string; blurb: string; sections: Section[]; faq?: Faq[] };
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
    diagram: "lifecycle",
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
    id: "org-roles",
    title: "Branches, roles & who sees what",
    persona: "public",
    route: "",
    noShot: true,
    diagram: "org",
    purpose: "How a multi-branch garage is structured, and what each role can do.",
    prose: [
      "The organisation is the account; each branch (location) is a workspace inside it. Everything operational — bookings, jobs, bays, invoices — belongs to a branch. Staff pick their active branch from the top-bar switcher and every page re-scopes to it.",
      "Org-level roles. Owner and admin can act in every branch and manage settings, the team and billing. Accountant is finance-only: dashboards, revenue, invoices, finance and reports across all branches, with no operational pages at all — ideal for a bookkeeper.",
      "Branch staff. Everyone else belongs to one or more branches with a branch role (manager, service advisor, mechanic…). What they can open is controlled by permission groups on the Team page — operational, financial, quotes, catalogue, sensitive and MOT. A page someone can't access simply doesn't appear in their navigation.",
      "Customers are org-wide: registering at one branch registers them with the whole garage group. Each customer has a home branch (used for reminders and marketing), while their vehicles remember the branch that services them.",
    ],
    notes: [
      "If a teammate says a page is 'missing', it's almost always a role or permission — an owner/admin can adjust it in Team & roles in under a minute.",
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
    diagram: "funding",
    purpose: "How prepaid service plans work — and why they're fair to both sides.",
    prose: [
      "A plan (e.g. 'Complete Care': one MOT + one service a year, plus 10% off everything else) is a prepayment, not credit. The customer pays monthly or annually, and the included services are drawn down as they're used.",
      "Included services are free at the point of booking only once the customer has paid in enough to cover them — the 'funding gate'. Until then, or once the period's allowance is used, the plan's everyday discount applies instead. This keeps the garage from ever being out of pocket and keeps the plan a simple prepayment in law.",
      "Onboarding. Covered services start 12 months after joining, unless the garage enrols the customer right after a full service + MOT — then they begin as soon as the plan is funded.",
      "Cancelling. A customer can cancel any time. They're refunded what they've paid in, minus any services already taken (charged at the normal walk-in price). They keep those services; nobody loses out. New plans also have a 14-day cooling-off period.",
      "Minimum terms. A minimum contract term only applies to business and fleet customers. Consumer plans never lock anyone in: cancelling is always available online from the customer portal in a couple of taps — no phone call or notice period required.",
    ],
    notes: [
      "Example: a member on 'Complete Care' books their included MOT. If their payments cover it, they pay £0 and the allowance shows 'MOT 0 of 1 left'. A second MOT in the same year falls back to the 10% member price.",
    ],
  },
  {
    id: "comms",
    title: "Messages to customers — what sends, when, and from which branch",
    persona: "public",
    route: "",
    noShot: true,
    diagram: "comms",
    purpose: "Every automatic email/SMS in one map, so nothing surprises you.",
    prose: [
      "Event messages follow the work: a booking confirmation, a quote link, an invoice or a payment receipt is sent by the branch where that work happens, with that branch's name and address on it — so a customer of a multi-branch group always knows which site to attend.",
      "Scheduled messages follow the customer: MOT/service reminders and marketing campaigns go out from the customer's home branch, and each customer is contacted once even if their vehicles are serviced at several branches.",
      "Channels. Email is always available; SMS and WhatsApp send where the garage has connected Twilio. Essential service messages (reminders, confirmations) send regardless of marketing consent; campaigns respect the customer's marketing opt-in.",
      "Overdue invoices get a gentle automatic chase (dunning); pending quotes get reminder emails on the schedule set in Settings; completed visits can trigger a review request with the garage's Google review link.",
    ],
    notes: [
      "Customers manage marketing consent themselves in their portal Settings; staff can see (not edit) consent on the customer record.",
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
  {
    id: "getting-help",
    title: "Getting help — the support widget",
    persona: "public",
    route: "",
    noShot: true,
    purpose: "Where staff go when something's unclear, broken or missing.",
    prose: [
      "Every staff page has a Support button (the life-ring, top right, next to the bell). It opens a small panel with an assistant that answers from this manual and from the garage's own settings — opening hours, connected integrations, services — and it respects roles, so it will never reveal something the signed-in person couldn't see in the app.",
      "When the assistant can't help, 'Still stuck — raise a ticket' sends the question to the AI Garage team with helpful context attached automatically (the page you were on, your branch and role, and an optional screenshot you can switch off).",
      "Replies land back in the widget and by email; the launcher shows a red badge when there's an unread reply. Bugs, questions and feature requests all go through the same place — feature requests the team adopts are marked 'planned' on your ticket.",
    ],
    notes: [
      "The fastest bug reports include what you were doing, what you expected and what happened instead — the widget attaches the technical context for you.",
    ],
  },
];

const conceptsFaq: Faq[] = [
  { q: "Do customers need the app installed?", a: "No — the customer portal is a website. Customers use the link the garage sends (or the garage's own web address) on any phone or computer." },
  { q: "Can one person work at two branches?", a: "Yes. A staff member can belong to several branches and switches between them with the top-bar branch selector. Owners, admins and accountants see every branch automatically." },
  { q: "Who holds the money when a customer pays?", a: "The garage. Payments go straight into the garage's own Stripe account — AI Garage never holds funds, it only takes a small platform fee per transaction." },
  { q: "What happens if we disconnect Stripe or Xero?", a: "Past data is untouched. Customers simply can't pay online (Stripe) or invoices stop syncing (Xero) until it's reconnected in Settings → Integrations." },
  { q: "Why can't a colleague see a page I can see?", a: "Roles and permissions. Pages a person can't access are hidden from their navigation entirely. An owner or admin can change their permissions on the Team page." },
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
      "Add your vehicle by registration — the make, model and MOT due date fill in automatically from the DVLA.",
    ],
    notes: ["One account covers every branch of the same garage group — you don't register twice."],
    troubleshooting: [
      { problem: "\"An account already exists for this email\"", fix: "You've registered before — use Sign in instead, and the email-link option if you've forgotten the password." },
      { problem: "Your registration plate isn't recognised", fix: "Double-check the plate. If it's a very new or imported vehicle the DVLA record may lag — you can still add it manually and the garage can fix details later." },
    ],
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
    troubleshooting: [
      { problem: "The email link never arrives", fix: "Check spam/junk first. The link is one-time and expires — request a fresh one rather than reusing an old email." },
      { problem: "Forgotten password", fix: "Use 'Forgotten password?' on the password tab, or simply switch to the email-link tab — no password needed." },
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
      "Choose the vehicle and a preferred date and time — only days the branch is open are offered.",
      "If the service is covered by your plan you'll see a green 'Included in your plan' note and pay nothing; otherwise any deposit or fee is shown before you confirm.",
      "Submit the request — the garage confirms the slot and you get a notification.",
    ],
    notes: ["'Pay now to confirm' appears only when the service has a price and the garage takes card payments. Covered plan services skip payment entirely."],
    troubleshooting: [
      { problem: "The date you want isn't offered", fix: "The branch is closed that day (weekly hours or a one-off closure). Pick another day or contact the garage directly." },
      { problem: "A plan service isn't showing as included", fix: "Your plan may not have accrued enough yet (plans are prepayments — see 'Membership plans' in How it works) or this period's allowance is used. The member discount still applies." },
    ],
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
    video: { caption: "Watch: opening a quote, reviewing the items and approving it — about 20 seconds." },
    purpose: "The detail of a single quote, with everything you need to decide.",
    steps: [
      "Review each recommended item and its price; watch the inspection video if one is attached.",
      "Approve & authorise the work, or decline it.",
      "If a deposit is required, pay it securely here to lock in the booking.",
    ],
    troubleshooting: [
      { problem: "The quote has expired", fix: "Quotes are valid for a set number of days. Ask the garage to reissue it — prices are then re-confirmed." },
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
    troubleshooting: [
      { problem: "Card payment failed", fix: "The invoice stays open — just press 'Pay now' and try again (or another card). If it keeps failing, your bank may be declining the payment; the garage can also take payment in person." },
      { problem: "'Spread the cost' isn't showing", fix: "Finance appears only where the garage has enabled it and the invoice amount qualifies. Ask the garage about their threshold." },
    ],
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
      "Cancelling refunds what you've paid in, minus any services already taken at the normal walk-in price. New plans have a 14-day cooling-off period. Consumer plans have no minimum term — you can cancel online any time, right from this page.",
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
  {
    id: "health-check-report",
    title: "Your vehicle health check report",
    persona: "customer",
    route: "",
    noShot: true,
    purpose: "The garage's inspection findings, with photos — approve work item by item.",
    prose: [
      "After an inspection the garage sends a link to your vehicle's health report — no login needed. Each finding shows a photo, how urgent it is (red = needs attention now, amber = keep an eye on it) and a price to put it right.",
      "Tick the items you want done and approve — they go straight onto the garage's job. Anything you decline is kept on your vehicle's record so it isn't forgotten next time.",
    ],
  },
  {
    id: "account",
    title: "Your account (trade & fleet)",
    persona: "customer",
    route: "/dashboard/account",
    purpose: "For account customers: your balance, open invoices and monthly statement.",
    steps: [
      "The balance card shows what's on account — invoiced amounts plus work awaiting the monthly invoice — with aged totals.",
      "Open invoices show exactly what's left to pay after part-payments.",
      "The statement shows each month's invoices and payments with a running balance; use the arrows to look back.",
    ],
    notes: ["Only visible if the garage has set you up as an account customer — ask them about payment terms."],
  },
];

const customerFaq: Faq[] = [
  { q: "Do I have to pay online?", a: "No — online card payment is a convenience. You can always pay at the garage; the invoice simply stays open until it's settled either way." },
  { q: "Will I get reminded before my MOT?", a: "Yes — the garage sends MOT and service reminders automatically as the due date approaches, by email (and SMS where enabled). These are service messages, separate from marketing." },
  { q: "Can I stop marketing messages but keep reminders?", a: "Yes. Settings → toggle marketing email/SMS off. Reminders and booking confirmations still arrive because they're about your vehicle, not marketing." },
  { q: "How do I cancel my plan?", a: "Plans page → Cancel plan. It stops immediately and refunds your unspent balance (services already used are charged at the normal price). Consumer plans have no minimum term." },
  { q: "Is my card stored?", a: "Card details are held by Stripe, the payment provider — the garage and AI Garage never see the full number. Saving a card is optional and only used for the purposes shown when you save it (e.g. no-show protection)." },
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
      "Multi-branch staff pick a branch next; everyone else lands straight on the dashboard.",
    ],
    troubleshooting: [
      { problem: "Signed out in the middle of a shift", fix: "Sessions end automatically 12 hours after sign-in — a security measure, not a fault. Sign back in and carry on." },
      { problem: "Locked out / forgotten password", fix: "An owner or admin can reset your access from Team & roles. Owners use the password reset link on the sign-in page." },
    ],
  },
  {
    id: "dashboard",
    title: "Staff dashboard",
    persona: "staff",
    route: "/staff",
    purpose: "Today at a glance: your day, the schedule, vehicles needing attention and key numbers.",
    steps: [
      "'My day' pins your own clocked-on state and open jobs assigned to you.",
      "Tiles track active jobs, today's bookings, quotes awaiting, low stock, courtesy cars out and no-shows — each links to its page.",
      "The day schedule shows each bay's bookings on a timeline; use 'New booking' to add one.",
      "Priority actions list where to focus now (overdue invoices, quotes waiting, vehicles due).",
      "Switch your active branch from the top-bar selector — every figure re-scopes to it.",
    ],
    notes: ["What you see is role-aware: owners and accountants get the financial tiles; mechanics see their own work first."],
  },
  {
    id: "bookings",
    title: "Bookings",
    persona: "staff",
    route: "/staff/bookings",
    video: { caption: "Watch: creating a booking from scratch — customer, vehicle, service, bay and time — in under a minute." },
    purpose: "Manage appointments in calendar or list view.",
    steps: [
      "Switch between month, day and list views; filter by status or assignee.",
      "Days the branch is closed are greyed; the 'Now' line tracks the current time on the day view.",
      "Open a booking to assign a staff member and bay, confirm with the customer, or reschedule.",
      "Create a new booking with 'New booking'. Turning a booking into a job moves it to the workshop board.",
    ],
    troubleshooting: [
      { problem: "Can't book a slot", fix: "Check the branch's opening hours (Settings → Business) and any special-day closure for that date — the calendar only offers open days." },
      { problem: "Customer says they never got the confirmation", fix: "Open the booking and re-send the confirmation. Check the email address on the customer record and ask them to check spam." },
    ],
  },
  {
    id: "booking-detail",
    title: "Inside a booking",
    persona: "staff",
    route: "/staff/bookings",
    capture: { clickSequence: ["text=List", "a[href*='/staff/bookings/']"] },
    purpose: "One appointment end to end: assignment, confirmation, payment state and history.",
    steps: [
      "Assign the bay and the staff member doing the work; both show on the day schedule.",
      "Send or re-send the confirmation; the customer can confirm from the email link.",
      "Take a deposit or card-on-file where the service requires it; the payment state shows here.",
      "Reschedule, cancel, or mark no-show; converting to a job carries everything across to the workshop board.",
    ],
  },
  {
    id: "booking-new",
    title: "New booking",
    persona: "staff",
    route: "/staff/bookings/new",
    purpose: "Book a customer in — existing or brand new — in one form.",
    steps: [
      "Search an existing customer or create one inline (name + contact is enough to start).",
      "Pick the vehicle (or add by registration — DVLA fills the details), the service and the bay.",
      "Choose date and time; the form warns if you pick a time outside the branch's opening hours.",
      "Save — the booking appears on the calendar and the customer gets a confirmation.",
    ],
    notes: ["Booking for a customer whose home branch is elsewhere? A note reminds you they normally visit another branch — carry on if that's intended."],
  },
  {
    id: "jobs",
    title: "Jobs — the workshop board",
    persona: "staff",
    route: "/staff/jobs",
    purpose: "Every job by stage: open, completed, invoiced.",
    steps: [
      "Cards show the vehicle, customer, assignee and a high-voltage (⚡ EV) flag where it applies.",
      "Open a job to add parts and labour, record work and mark it complete.",
      "Completed jobs flow through to invoicing in one step.",
    ],
    notes: ["The ⚡ flag means an electric/hybrid vehicle with high-voltage systems — only EV-qualified mechanics should work on it (see 'Badges & signs')."],
  },
  {
    id: "job-detail",
    title: "Inside a job",
    persona: "staff",
    route: "/staff/jobs",
    capture: { clickToDetail: "a[href*='/staff/jobs/']" },
    purpose: "The working record of a visit: line items, time, checks, quotes and the invoice.",
    steps: [
      "Add parts (from Products) and labour lines as the work happens; totals and VAT update live — the margin strip shows the job's gross profit as you go.",
      "Run a digital health check from the job (where enabled) or record tyre checks; attach photos/video for the customer.",
      "Found extra work? Raise a quote from the job — the customer approves it from their portal before you proceed, and the approval is kept as a signed authorisation.",
      "Clock time against the job; mark it complete, then 'Create invoice' carries every line across.",
    ],
    troubleshooting: [
      { problem: "Part not in the picker", fix: "It's not in Products yet — add it there (or ask someone with catalogue permission), then it's available on every job." },
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
      "Add a new customer with 'New customer', or bring a whole book across with Import.",
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
      "Overview shows contact details and marketing consent (view-only — the customer controls consent), the Trade account panel for account customers, and any past invoices imported from a previous system.",
      "Vehicles lists each car with MOT/service dates; add one by registration. Imported service history and outstanding deferred work show beneath.",
      "The Memberships tab lists plans; staff can bring plan benefits forward when a customer enrols right after a service + MOT.",
      "Reminder history records every MOT/service nudge sent and whether it was delivered.",
      "GDPR tools (owner/admin): export the customer's data, or erase them permanently.",
    ],
  },
  {
    id: "customers-import",
    title: "Importing from your old system",
    persona: "staff",
    route: "/staff/customers/import",
    purpose: "Move customers, vehicles, service history, reminder dates and past invoices in from CSV.",
    steps: [
      "Pick what you're importing: customers & vehicles first, then service history, reminder dates and past invoices.",
      "Upload the CSV. Known exports (TechMan, Garage Hive, Autowork Online) map their columns automatically; anything else auto-matches by header, and 'Suggest mapping with AI' can propose the rest — you always confirm.",
      "Check the preview: what will be created, plus every skipped row with its reason. Nothing is saved yet.",
      "Import. If anything fails mid-way the whole batch rolls back — nothing partial is ever kept.",
    ],
    notes: [
      "Order matters: customers & vehicles first — everything else matches on registration or email.",
      "Imported history and past invoices are badged 'imported history' and kept out of your jobs, revenue and reports. Reminder dates only fill blanks unless you tick overwrite.",
      "Imports don't email anyone — customers are simply ready in the directory for the next booking.",
    ],
    troubleshooting: [
      { problem: "Rows skipped with 'no vehicle with registration…'", fix: "Import customers & vehicles first, then re-run the history/reminders file — matching is by registration." },
      { problem: "Dates rejected", fix: "Use dd/mm/yyyy or yyyy-mm-dd. If the file went through Excel, check it didn't switch dates to US format." },
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
    troubleshooting: [
      { problem: "Customer didn't get the quote", fix: "Open the quote and re-send. The link needs no login — check spam and that the email on the customer record is right." },
      { problem: "Quote expired before they answered", fix: "Reissue it (revise) — validity days are set in Settings → Integrations." },
    ],
  },
  {
    id: "quote-new",
    title: "Creating a quote",
    persona: "staff",
    route: "/staff/quotes/new",
    purpose: "Build a priced recommendation the customer can approve from their phone.",
    steps: [
      "Pick the customer and vehicle (or quote a walk-in by contact details).",
      "Add line items from your services and products, or free-type; set quantities and prices.",
      "Attach an inspection photo or video — approval rates jump when the customer can see the problem.",
      "Send. The customer gets a secure link (no login needed) to approve, decline or pay a deposit.",
    ],
  },
  {
    id: "invoices",
    title: "Invoices",
    persona: "staff",
    route: "/staff/invoices",
    roles: "Branch staff with financial permission · Owner · Admin · Accountant",
    purpose: "The invoice register with status totals and search.",
    steps: [
      "Filter by status — draft, sent, paid, overdue — or search by customer or number.",
      "Totals by status sit across the top so you can see what's outstanding.",
      "Open an invoice to send it, record a payment or issue a refund.",
      "Run month end (top right) raises one consolidated invoice per account customer for the month's unbilled jobs.",
    ],
  },
  {
    id: "invoice-detail",
    title: "Inside an invoice",
    persona: "staff",
    route: "/staff/invoices",
    roles: "Branch staff with financial permission · Owner · Admin · Accountant",
    capture: { clickToDetail: "a[href*='/staff/invoices/']" },
    purpose: "Send, take payment, credit or refund one invoice.",
    steps: [
      "Line items, VAT and any plan credit/discount are itemised exactly as the customer sees them.",
      "Send (or re-send) by email; the customer pays from the link — or record a payment taken in person.",
      "Issue a credit note or refund where needed; everything lands in the audit log.",
      "Overdue invoices are chased automatically (dunning); you can see what's been sent.",
    ],
    troubleshooting: [
      { problem: "Customer paid but it shows unpaid", fix: "Card payments mark themselves within moments. For bank transfers or cash, record the payment manually here." },
    ],
  },
  {
    id: "revenue",
    title: "Revenue",
    persona: "staff",
    route: "/staff/revenue",
    roles: "Owner · Admin · Accountant",
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
    roles: "Owner · Admin · Accountant",
    purpose: "Analytics: profitability, VAT, aged debt, labour productivity and bay utilisation.",
    steps: [
      "Pick a period — this month, year-to-date or a custom range.",
      "Profitability shows gross profit, margin % and your effective labour rate for jobs paid in the period.",
      "Review the VAT summary and aged-debtor buckets (current, 1–30, 31–60, 60+ days) — aged debt is what's actually outstanding after part-payments.",
      "Productivity and utilisation break billable hours down by mechanic.",
    ],
  },
  {
    id: "finance",
    title: "Finance applications",
    persona: "staff",
    route: "/staff/finance",
    roles: "Owner · Admin · Accountant",
    purpose: "Track 'spread the cost' finance applications against invoices.",
    steps: [
      "Each application shows the invoice, provider, amount and current state.",
      "The garage is paid in full by the provider — the customer repays them in instalments.",
    ],
    notes: ["Finance appears to customers only where it's enabled and the invoice amount qualifies."],
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
      "Duration drives the calendar slot length; price drives the booking and quote defaults.",
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
      "Stock at or below the reorder level flags items to order — the dashboard's 'low stock' tile counts them.",
      "Restock through Purchase orders; receiving a PO tops the quantities back up.",
    ],
  },
  {
    id: "suppliers",
    title: "Suppliers",
    persona: "staff",
    route: "/staff/suppliers",
    purpose: "The address book behind purchase orders.",
    steps: [
      "Keep each parts supplier's contact details and notes in one place.",
      "Suppliers feed the purchase-order form — pick one instead of retyping details.",
    ],
  },
  {
    id: "purchase-orders",
    title: "Purchase orders",
    persona: "staff",
    route: "/staff/purchase-orders",
    purpose: "Order parts from suppliers and receive them into stock.",
    steps: [
      "Raise a PO against a supplier; add product lines and quantities.",
      "Send it, then mark lines received when the parts arrive — stock levels update automatically.",
      "Part-receipts are fine: receive what turned up, the rest stays on order.",
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
    id: "automations",
    title: "Automations",
    persona: "staff",
    route: "/staff/automations",
    roles: "Owner · Admin",
    purpose: "The scheduled messages that run without you: reminders, digests, dunning, review requests.",
    steps: [
      "Each automation shows its schedule and when it last ran.",
      "Reminders nudge customers ahead of MOT/service dates; dunning chases overdue invoices gently; review requests follow completed visits.",
      "Turn an automation on or off per branch; sending respects each customer's contact consent.",
    ],
  },
  {
    id: "campaigns",
    title: "Campaigns",
    persona: "staff",
    route: "/staff/campaigns",
    roles: "Owner · Admin",
    purpose: "One-off marketing to your customer base — promotions, announcements, seasonal pushes.",
    steps: [
      "Write the message and choose the audience; the recipient count shows before you send.",
      "Send by email or SMS. Only customers with marketing consent are included, automatically.",
      "Each customer is contacted once, from their home branch.",
    ],
    notes: ["Campaigns are gated by your AI Garage subscription tier — the page tells you if an upgrade is needed."],
  },
  {
    id: "win-back",
    title: "Win-back",
    persona: "staff",
    route: "/staff/win-back",
    roles: "Owner · Admin",
    purpose: "Customers who've drifted — vehicles overdue a visit — ready for a nudge.",
    steps: [
      "The list surfaces vehicles with no recent visit and an MOT or service now due.",
      "Reach out directly or fold them into a campaign.",
    ],
  },
  {
    id: "fleet",
    title: "Fleet",
    persona: "staff",
    route: "/staff/fleet",
    purpose: "Business customers with multiple vehicles, managed as one account.",
    steps: [
      "Each fleet company groups its vehicles, bookings and invoices under one umbrella.",
      "Open a fleet to see all its vehicles and their MOT/service status in one table.",
      "Fleet plans can carry minimum terms (unlike consumer plans).",
    ],
  },
  {
    id: "courtesy-cars",
    title: "Courtesy cars",
    persona: "staff",
    route: "/staff/courtesy-cars",
    purpose: "Loan cars: the small fleet you lend while customers' vehicles are in.",
    steps: [
      "Each car shows its details and current state — available or out on loan.",
      "Issue a car against a booking/job; record the return when the customer brings it back.",
      "The dashboard tile counts cars out and flags overdue returns.",
    ],
  },
  {
    id: "bays",
    title: "Bays",
    persona: "staff",
    route: "/staff/bays",
    roles: "Owner · Admin",
    purpose: "The physical workshop bays the calendar schedules into.",
    steps: [
      "Add, rename or retire bays (e.g. 'MOT bay', 'Ramp 2').",
      "Every bay becomes a row on the day schedule; bookings and jobs are assigned to one.",
    ],
  },
  {
    id: "receptionist",
    title: "AI receptionist",
    persona: "staff",
    route: "/staff/receptionist",
    roles: "Owner · Admin",
    purpose: "Answers missed calls by text, quotes services and books customers into real slots.",
    steps: [
      "Connect a phone number (Twilio) and switch the receptionist on.",
      "It texts back callers you missed, answers service/price questions from your catalogue, and offers genuine free slots.",
      "Review its conversations here — every booking it makes lands on the calendar like any other.",
    ],
  },
  {
    id: "notifications",
    title: "Notifications",
    persona: "staff",
    route: "/staff/notifications",
    purpose: "The bell, and the archive behind it.",
    steps: [
      "The bell (top right) badges unread events — new bookings, payments, quote responses.",
      "This page is the full archive; open any row to jump to the thing itself.",
      "Notification preferences let you mute kinds you don't need.",
    ],
  },
  {
    id: "support",
    title: "Support widget",
    persona: "staff",
    route: "/staff",
    capture: { waitFor: "text=MY DAY" },
    stepper: [
      { caption: "The Support launcher lives next to the bell on every staff page." },
      { caption: "Ask the assistant anything — it answers from the manual and your garage's own settings." },
      { caption: "Still stuck? Raise a ticket — context (page, branch, role, optional screenshot) attaches automatically." },
    ],
    video: { caption: "Watch: asking the assistant a question, then raising a ticket — 30 seconds." },
    purpose: "Help without leaving the page: an assistant that knows the product, and tickets to the AI Garage team.",
    steps: [
      "Open Support (life-ring, top right). Ask in plain English — it answers from this manual and from your own garage's configuration, respecting your role.",
      "'TICKETS · n' shows your organisation's open tickets; the red badge means the team replied.",
      "Raise a ticket for bugs, questions or feature requests; replies land here and by email.",
    ],
  },
  {
    id: "settings",
    title: "Settings",
    persona: "staff",
    route: "/staff/settings",
    roles: "Owner · Admin",
    purpose: "Organisation configuration: branding, hours, locations, integrations and compliance.",
    steps: [
      "Business: logo, brand colour, contact details, and per-day opening hours with one-off special days (bank holidays).",
      "Locations: add branches and set the primary location.",
      "Integrations: connect Stripe and Xero, set the deposit % and quote validity.",
      "Compliance: accept the Data Processing Agreement and set MFA enforcement.",
    ],
    notes: ["Some actions (managing the team, GDPR) stay locked to owner/admin even when other permissions are granted."],
    troubleshooting: [
      { problem: "Changed opening hours but old bookings look wrong", fix: "Hour changes affect future availability only — existing bookings keep their slot. Move them by hand if needed." },
      { problem: "Stripe shows 'charges not enabled'", fix: "Stripe onboarding isn't finished — reopen the Stripe connect flow from Integrations and complete the remaining steps." },
    ],
  },
  {
    id: "billing",
    title: "Your AI Garage subscription",
    persona: "staff",
    route: "/staff/settings/billing",
    roles: "Owner · Admin",
    purpose: "The garage's own subscription to AI Garage — tier, invoices, payment method.",
    steps: [
      "See your current tier and what it includes; upgrade or downgrade takes effect next period.",
      "Update the payment card and download AI Garage's invoices to you (separate from your customers' invoices).",
    ],
  },
  {
    id: "staff-members",
    title: "Team & roles",
    persona: "staff",
    route: "/staff/staff-members",
    roles: "Owner · Admin",
    purpose: "Invite teammates and control what each can see and do.",
    steps: [
      "Invite staff by email and set an org role (owner, admin, accountant) or a per-branch role.",
      "Grant permissions by group — operational, financial, quotes, catalogue, sensitive, MOT.",
      "'Add location access' gives an existing member another branch.",
      "Flag MOT testers / QC reviewers and EV (SERMI) certification where relevant.",
    ],
    notes: ["Accountant is an org-wide, finance-read-only role — handy for a bookkeeper who shouldn't touch operations."],
    troubleshooting: [
      { problem: "A teammate can't see a page", fix: "Check their permission groups here — pages they lack access to are hidden from their navigation entirely." },
    ],
  },
  {
    id: "team-roles",
    title: "Role templates",
    persona: "staff",
    route: "/staff/settings/team-roles",
    roles: "Owner · Admin",
    purpose: "Reusable permission bundles so new starters get the right access in one click.",
    steps: [
      "Define a template (e.g. 'Service advisor') with its permission groups.",
      "Apply it when inviting or editing a team member; tweak individual permissions after if needed.",
    ],
  },
  {
    id: "health-checks",
    title: "Vehicle health checks (eVHC)",
    persona: "staff",
    route: "",
    noShot: true,
    purpose: "A 33-point digital inspection the customer approves item by item.",
    prose: [
      "Open a job and tap Health check. Work through the checklist on a phone: grade only the exceptions red (urgent) or amber (advisory), add a photo per finding, and confirm the rest are OK in one tap. Progress autosaves — a dropped connection loses nothing.",
      "When the check is complete, AI rewrites the technician shorthand into customer-friendly wording and suggests the repair for each finding — every line stays editable. Red and amber findings become a draft quote in one tap.",
      "Send the report by email, SMS or WhatsApp. The customer sees photos, urgency and a price per finding, and approves item by item from their phone — approved work lands straight on the job, exactly like a quote approval (deposits, reminders and expiry included).",
      "Anything declined or left unanswered doesn't disappear: it lands in Deferred work and is shown as 'previously advised' on the vehicle's next job.",
    ],
    roles: "Technicians capture · quotes permission to send",
    troubleshooting: [
      { problem: "No Health check button on the job", fix: "eVHC is rolled out gradually — if you don't see it, it isn't enabled for the platform yet. Ask via the Support widget." },
      { problem: "Customer didn't get the report", fix: "Open the inspection and re-send; the link needs no login. Check the customer's email/phone on their record." },
    ],
  },
  {
    id: "deferred",
    title: "Deferred work",
    persona: "staff",
    route: "/staff/deferred",
    roles: "Quotes permission to action",
    purpose: "Every repair a customer declined or was advised of but never booked — with its value.",
    steps: [
      "The open pipeline shows each item with price, urgency and age; the tiles up top total what's outstanding and what came back this month.",
      "The automated follow-up (Automations → Deferred work follow-ups) chases each item at 14 and 30 days with a booking link.",
      "When the customer books, the item flips to recovered and counts as recovered revenue; dead items can be dismissed with a reason.",
    ],
    notes: ["Items are created automatically — from declined quote lines and from health-check advisories that never became a quote. Nothing needs manual entry."],
  },
  {
    id: "authorisations",
    title: "Work authorisations",
    persona: "staff",
    route: "/staff/authorisations",
    purpose: "Tamper-proof proof of what the customer agreed to, for every approval.",
    steps: [
      "Every quote approval automatically records an authorisation: the exact items and total, when it was approved, and from where.",
      "If work grows mid-job (a variation), send a one-tap re-authorisation before doing the extra — the customer approves the difference from their phone.",
      "Open any authorisation for a print view — useful for disputes and trade bodies.",
    ],
    notes: ["Authorisations are immutable snapshots — revising the quote afterwards never changes what was signed."],
  },
  {
    id: "trade-accounts",
    title: "Trade & fleet accounts",
    persona: "staff",
    route: "/staff/customers",
    roles: "Invoice permission",
    capture: { clickToDetail: 'tr:has-text("Charlie")', waitFor: "text=Customers" },
    purpose: "Account customers: payment terms, credit limits, one monthly invoice and statements.",
    steps: [
      "On the customer page, turn on Trade account and set payment terms and an optional credit limit. The live balance (invoiced + unbilled work) shows alongside.",
      "With consolidated billing on, completed jobs accrue unbilled and 'Raise consolidated invoice' turns a month's work into one invoice — one line per job, registration on each line. Run all account customers at once from Invoices → month end.",
      "Record part-payments as they arrive; they spread across open invoices oldest-first, and overpayments sit as credit.",
      "Statements (print or email) show the period's invoices and payments with a running balance and aged totals. Overdue account customers get one grouped reminder, not one per invoice.",
    ],
    notes: [
      "Over the credit limit? New bookings warn (or block, per your setting in the org's credit control mode).",
      "Fleet contacts see their balance, open invoices and statement in the customer portal under 'Your account'.",
    ],
  },
  {
    id: "profitability",
    title: "Job profitability",
    persona: "staff",
    route: "",
    noShot: true,
    roles: "Owner · Admin · Accountant",
    purpose: "Gross profit on every job, on the dashboard, and in the weekly digest.",
    prose: [
      "Set your labour cost rate once (Settings → Business → costing) and give parts a unit cost as you add them — stock items carry their cost automatically. Every job then shows a margin strip: parts cost, labour cost at your rate, and gross profit.",
      "Reports adds the month's gross profit, margin percentage and your effective labour rate (invoiced ÷ hours clocked). The dashboard's finance tiles carry the same numbers, and the weekly digest includes a short AI note on what's dragging margin — with the one action worth taking.",
      "Part lines with no cost are counted and flagged rather than guessed — the reports tell you how many lines are missing costs so the numbers earn trust gradually.",
    ],
  },
  {
    id: "website",
    title: "Your garage website",
    persona: "staff",
    route: "/staff/settings?tab=website",
    roles: "Owner · Admin",
    capture: { waitFor: "text=Your garage website" },
    purpose: "A fast one-page marketing site at your booking address — built from what's already in AI Garage.",
    steps: [
      "Settings → Website. Everything comes from data you already maintain: services with from-prices, live opening hours (special days included), branches with directions/call/WhatsApp, your Google reviews link.",
      "'Write it for me' drafts the strapline and about text from your AI setup answers — edit anything, nothing publishes itself.",
      "Add up to 8 workshop photos, toggle sections on or off, and Publish. Unpublishing brings the simple welcome page back.",
      "The page is built for Google: per-branch pages, structured data and a sitemap — the things that get a garage onto the map pack.",
    ],
    notes: ["Search engines only see the site while it's published. The booking page itself works either way."],
  },
  {
    id: "setup-checklist",
    title: "Getting set up (the checklist)",
    persona: "staff",
    route: "/staff",
    roles: "Owner · Admin",
    capture: { waitFor: "text=Getting set up" },
    purpose: "A self-completing checklist from signup to first invoice.",
    steps: [
      "Each step is derived from real data — add your services and the services step ticks itself. Nothing is manually checked off.",
      "Every step has a deep link to the right screen and an 'Ask AI' shortcut that opens the support assistant primed with that step's how-to.",
      "When your booking page is ready, copy the link straight from the card and put it on Facebook and your Google Business Profile.",
      "The card disappears at 100% (or dismiss it for the whole organisation once you're settled).",
    ],
    notes: ["Brand-new with no customers yet? 'Explore with sample data' loads a clearly-badged demo dataset — customers, a week of bookings, jobs and an invoice — and one click wipes it all. Sample rows never email anyone and never count as real activity."],
  },
  {
    id: "csat-pulse",
    title: "The post-service pulse",
    persona: "staff",
    route: "",
    noShot: true,
    purpose: "One-tap satisfaction after every job, with unhappy customers intercepted.",
    prose: [
      "After each completed job the customer gets a one-tap 'How was it?' by email, SMS or WhatsApp. Happy scores are pointed at your Google review link; unhappy ones are intercepted — they come to you as a message first, before anything public.",
      "The dashboard's CSAT tile shows the rolling 90-day score and reply rate, and each customer's record shows their individual responses. Customers are never asked more than once every 30 days.",
    ],
  },
  {
    id: "whats-new",
    title: "What's new",
    persona: "staff",
    route: "/staff/whats-new",
    purpose: "Release notes, in plain English, inside the app.",
    steps: [
      "New releases pop up once per browser and show a NEW pill in the navigation for two weeks.",
      "Each entry says what changed and what it means for your day — no version numbers to decode.",
    ],
  },
  {
    id: "account",
    title: "My account",
    persona: "staff",
    route: "/staff/account",
    purpose: "Your own sign-in security: password, passkeys, MFA.",
    steps: [
      "Change your password, or add a passkey (Face ID / fingerprint / security key) for faster, phishing-resistant sign-in.",
      "If your organisation enforces MFA, set it up here.",
    ],
  },
  {
    id: "audit-log",
    title: "Audit log",
    persona: "staff",
    route: "/staff/audit-log",
    roles: "Owner · Admin (or audit permission)",
    purpose: "An append-only trail of staff actions for GDPR and finance compliance.",
    steps: [
      "Filter by action group (GDPR, financial, quotes, integrations, auth), actor or action.",
      "Each row records who did what, when, and from where.",
    ],
  },
];

const staffFaq: Faq[] = [
  { q: "Why was I signed out?", a: "Staff sessions end 12 hours after sign-in, full stop — it's a security measure. Sign back in and your work is where you left it." },
  { q: "A page my colleague has is missing for me — why?", a: "Permissions. Pages you can't access are hidden from navigation. An owner/admin can grant the permission group on the Team page." },
  { q: "Customer says they didn't get an email — where do I look?", a: "Open the thing you sent (booking, quote, invoice) and re-send it; check the email address on the customer record; ask them to check spam. Reminder history on the customer shows delivery status for reminders." },
  { q: "How do I close early on a bank holiday?", a: "Settings → Business → add a special day for that date (closed, or custom hours). It beats the weekly pattern for that day and the booking widget respects it immediately." },
  { q: "Where do refunds happen?", a: "On the invoice. Refunds are issued from your own Stripe account; a credit note records the paperwork and it all lands in the audit log." },
  { q: "What's the difference between Reminders and Campaigns?", a: "Reminders are per-vehicle service messages (MOT/service due) and send regardless of marketing consent. Campaigns are marketing to many customers at once and only go to customers who've opted in." },
  { q: "Where do I ask for a new feature?", a: "The Support widget (life-ring, top right) → raise a ticket → type 'Feature request'. Ones the team adopts show as 'planned' on your ticket." },
];

export const MANUAL: Manual = {
  title: "AI Garage — User Manual",
  subtitle: "An end-to-end guide to the customer portal and the staff back office.",
  parts: [
    {
      name: "How it works",
      blurb: "Start here — the concepts behind the screens.",
      sections: concepts,
      faq: conceptsFaq,
    },
    {
      name: "Customer guide",
      blurb: "For vehicle owners using the garage's online portal.",
      sections: customer,
      faq: customerFaq,
    },
    {
      name: "Staff guide",
      blurb: "For garage employees running the back office.",
      sections: staff,
      faq: staffFaq,
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
