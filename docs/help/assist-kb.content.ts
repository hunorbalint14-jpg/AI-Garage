/*
 * Curated knowledge base for the support widget's assist chat — answers for
 * common questions the user manual doesn't cover in depth (troubleshooting,
 * policies, how-it-works). Maintained by PR, same as manual.content.ts.
 *
 * Each entry becomes a retrieval doc alongside the manual sections. Keep
 * bodies plain-text, staff-facing, British English, and free of promises we
 * haven't shipped. `keywords` boost retrieval for phrasings the body doesn't
 * naturally contain.
 */

export type KbEntry = {
  /** Stable slug — becomes the retrieval anchor `kb-<id>`. */
  id: string;
  title: string;
  /** Extra retrieval terms (lowercase). */
  keywords: string[];
  body: string;
};

export const ASSIST_KB: KbEntry[] = [
  {
    id: "branches-and-roles",
    title: "Branches, roles and who sees what",
    keywords: ["multi branch", "location", "permission", "access", "switch branch", "role"],
    body: [
      "Your organisation is the account; each branch (location) is a workspace inside it. Staff belong to one or more branches; owners and admins can act in every branch. The active branch is chosen from the top-bar switcher and everything operational (bookings, jobs, invoices) is scoped to it.",
      "Org-level roles: owner and admin have full access everywhere; accountant is a finance-only role — dashboards, revenue, invoices, finance and reports across all branches, but no operational pages. Branch staff see the branches they're a member of, with page access controlled by per-member permissions set on the Team page.",
      "Customers are shared across the whole organisation: a customer registered at one branch is visible at all of them, with a home branch used for reminders and marketing.",
    ].join("\n"),
  },
  {
    id: "opening-hours",
    title: "Opening hours, special days and the booking widget",
    keywords: ["hours", "open", "closed", "sunday", "bank holiday", "special hours", "override"],
    body: [
      "Opening hours are set per day of the week in Settings → Business (owners/admins). Each weekday can have its own open and close time, or be marked closed.",
      "One-off exceptions (bank holidays, staff days out) are dated overrides: add a special day with custom hours or closed. Overrides beat the weekly pattern for that date.",
      "The public booking widget only offers slots on days the branch is open, and staff see a warning when they book outside the configured hours. Changing hours does not move existing bookings.",
    ].join("\n"),
  },
  {
    id: "payments-stripe",
    title: "Card payments and Stripe",
    keywords: ["stripe", "card", "payment", "payout", "connect", "pay link", "deposit"],
    body: [
      "Card payments run through your own Stripe account, connected in Settings → Integrations (owners/admins). Customers pay invoices from their portal or via a pay link; deposits on quotes use the deposit percentage configured in settings.",
      "Money settles to your Stripe account and follows your Stripe payout schedule — AI Garage never holds your funds. A small platform fee per transaction is taken automatically.",
      "If a customer says a payment failed, check the invoice status first: card failures show on the invoice, and they can simply retry from the same link. If Stripe shows as disconnected in settings, reconnecting restores payments without affecting past invoices.",
    ].join("\n"),
  },
  {
    id: "accounting-sync",
    title: "Accounting sync — Xero, QuickBooks and Sage",
    keywords: [
      "xero",
      "quickbooks",
      "sage",
      "accounting",
      "sync",
      "not syncing",
      "invoice export",
      "bookkeeping",
      "reconnect",
      "books health",
      "unsynced",
      "csv export",
      "accountant",
    ],
    body: [
      "One accounting connection per organisation — Xero, QuickBooks Online or Sage Business Cloud — set up in Settings → Integrations (owners/admins). Once connected, sales invoices, payments (including account payments allocated across several invoices), refund credit notes and Stripe payouts push across automatically, so the books stay current with no re-keying.",
      "Each invoice line carries its correct VAT coding into the package: standard-rated, zero-rated, VAT-exempt and outside-scope (the MOT fee) map to distinct tax codes, refunds carry the original invoice's VAT mix, and deleting an invoice here voids it in the package too.",
      "The Books health panel on the same settings page shows anything that hasn't reached the package yet — unsynced invoices, payments and refunds, recent failures, and how much of the last 30 days' takings is in the books. 'Retry sync now' re-pushes on the spot, and a nightly automatic sweep retries everything anyway, so one-off failures self-heal.",
      "If the saved authorisation expires (Sage lapses after about a month unused, QuickBooks after about three), a red 'reconnect needed' banner appears in Settings → Integrations and the owner gets an email. Reconnect from that banner — nothing is lost, and anything issued while disconnected backfills automatically.",
      "Accountant on different software? Download the sales CSV from Settings → Integrations: one row per invoice line with dates, customer and VAT treatment, ready to import into any MTD-compatible package. Add ?from=YYYY-MM-DD&to=YYYY-MM-DD to the download link for an exact VAT period.",
      "Not pushed automatically (your accountant handles these for now): quote deposits, service-plan subscription income, and Stripe's processing fees (payouts post as the net amount; fees are usually a periodic journal).",
    ].join("\n"),
  },
  {
    id: "making-tax-digital",
    title: "Making Tax Digital (MTD) — VAT and Income Tax",
    keywords: [
      "mtd",
      "making tax digital",
      "hmrc",
      "vat return",
      "digital link",
      "digital records",
      "quarterly update",
      "income tax",
      "self assessment",
      "sole trader",
      "compliant",
      "bridging",
      "file vat",
      "readiness",
    ],
    body: [
      "Making Tax Digital is HMRC's requirement that VAT records are kept digitally and VAT returns are filed through software. It applies to every VAT-registered business, whatever its size. The records must flow between software digitally ('digital links') — re-typing invoice totals from one system into another is specifically not allowed.",
      "How AI Garage fits: it keeps your digital sales record (every invoice line with its VAT treatment) and feeds it into HMRC-recognised accounting software — Xero, QuickBooks or Sage via the live sync, or any other MTD-compatible package via the sales CSV export. Your accounting package (or your accountant) files the actual VAT return. AI Garage itself is not listed on HMRC's software directory and does not file returns — HMRC's rules explicitly allow a set of programs joined by digital links, which is exactly this arrangement.",
      "The Making Tax Digital readiness card in Settings → Integrations checks the pieces for your organisation: VAT number saved and well-formed, a digital link connected and healthy (or the CSV route), nothing left unsynced, MOT services carrying the right VAT treatment, and your business structure recorded. Fix anything it flags and your sales side is MTD-ready.",
      "MTD for Income Tax is the newer wave and affects sole traders (not limited companies): from April 2026 sole traders with qualifying income over £50,000 must keep digital records and send HMRC cumulative quarterly updates through software (deadlines 7 August, 7 November, 7 February and 7 May), with the threshold dropping to £30,000 in April 2027 and £20,000 in April 2028. Your sales data flowing cleanly into your accounting software is what makes those updates painless — set your business structure in Settings → Payments & Quotes so the app can point you at the right guidance.",
      "HMRC charges penalty points for late submissions and percentage penalties for late payment, so a healthy sync isn't just tidy bookkeeping. For anything about your specific tax position, ask your accountant — AI Garage doesn't give tax advice.",
    ].join("\n"),
  },
  {
    id: "mot-vat",
    title: "VAT on MOT fees",
    keywords: [
      "mot vat",
      "mot fee",
      "outside scope",
      "test centre",
      "subcontract mot",
      "disbursement",
      "markup",
      "no vat on mot",
    ],
    body: [
      "An approved MOT test centre's fee (up to the statutory maximum) is outside the scope of VAT — no VAT on the MOT line, and it stays out of the VAT return's sales figures. Services named 'MOT' are flagged outside-scope automatically; you can check or correct any service's VAT treatment in Settings → Services.",
      "If your branch is NOT an approved test centre and subcontracts the MOT to one, HMRC's rule is stricter: only the exact amount the test centre charged you can go on the customer's invoice VAT-free. Any markup you add must be a separate standard-rated line — otherwise VAT is due on the whole fee. Set the branch's MOT arrangement in Settings → Payments & Quotes ('tested here' vs 'subcontracted'); when it's subcontracted, job screens with an MOT line show a reminder about the split.",
      "The Making Tax Digital readiness card also warns if an MOT-named service isn't marked outside-scope.",
    ].join("\n"),
  },
  {
    id: "vat-settings",
    title: "VAT registration, business structure and invoice numbering",
    keywords: [
      "vat number",
      "vat registered",
      "not vat registered",
      "business structure",
      "sole trader",
      "limited company",
      "invoice prefix",
      "invoice number",
      "numbering",
    ],
    body: [
      "Settings → Payments & Quotes (owner only) holds the VAT setup: whether the organisation is VAT-registered, and its VAT registration number. The number is format-checked (e.g. GB123456789) and prints on every invoice — a legal requirement for VAT invoices. Marked not registered, no invoice ever charges VAT.",
      "Business structure (sole trader / partnership / limited company) is recorded on the same page — it drives which tax guidance applies (Making Tax Digital for Income Tax affects sole traders, not limited companies).",
      "Invoice numbering is per branch: each branch has a prefix (e.g. SMI → SMI-INV-0042) and its own sequence. Numbers are allocated atomically and never reused; deleting a draft leaves a gap rather than re-issuing the number, which is what your accountant would expect.",
    ].join("\n"),
  },
  {
    id: "vehicle-lookup-mot",
    title: "Vehicle lookup, MOT history and reminders",
    keywords: ["dvla", "registration", "number plate", "mot due", "reminder", "recall"],
    body: [
      "Typing a registration looks the vehicle up against DVLA/DVSA — make, model, MOT due date and MOT history fill automatically, including outstanding safety recalls where available.",
      "MOT and service reminders send automatically to the customer as the due date approaches; each customer is contacted once, from their home branch, even if their vehicles were serviced at several branches. Customers can manage their contact preferences from their own portal.",
    ].join("\n"),
  },
  {
    id: "quotes-lifecycle",
    title: "Quotes: sending, reminders and expiry",
    keywords: ["quote", "estimate", "approve", "decline", "reminder", "expiry", "convert"],
    body: [
      "Quotes are sent to the customer by email with a secure link — no login needed. The customer approves or declines from that page; approval can take a deposit if configured.",
      "Pending quotes get automatic reminder emails on the schedule configured in settings (default: a few days apart, a limited number of reminders), and expire after the configured validity period. Approved quotes convert into bookings or jobs with the line items carried over.",
    ].join("\n"),
  },
  {
    id: "plans-funding",
    title: "Service plans and the funding rule",
    keywords: ["plan", "membership", "subscription", "funding", "prepayment", "coverage"],
    body: [
      "Service plans are prepayment plans: the customer pays monthly towards defined included services (e.g. an annual service and MOT). Coverage applies automatically at booking when the plan includes the service.",
      "The funding rule: a plan benefit can only be drawn once enough has actually been paid in to cover it — 'no draw before funded'. If a booking shows a plan as not yet covering a service, that's usually why; the customer can still pay normally and the plan keeps accruing.",
    ].join("\n"),
  },
  {
    id: "staff-sign-in-security",
    title: "Staff sign-in, passkeys and session timeouts",
    keywords: ["login", "password", "passkey", "mfa", "2fa", "signed out", "session expired"],
    body: [
      "Staff sign in with email and password, and can add a passkey (fingerprint/face/security key) for faster sign-in. Organisations can enforce MFA in Settings → Compliance.",
      "Sessions end automatically 12 hours after sign-in regardless of activity — if you were signed out mid-shift, that's the security timeout, not a fault. Sign back in and your work is where you left it.",
      "Locked out? An owner or admin can reset access from the Team page.",
    ].join("\n"),
  },
  {
    id: "customer-comms",
    title: "What messages customers receive, and from whom",
    keywords: ["email", "sms", "whatsapp", "branding", "sender", "notification", "confirmation"],
    body: [
      "Customers receive booking confirmations, quote links, invoices, payment receipts, and MOT/service reminders. Messages carry your organisation's branding, and always name the specific branch with its address so customers of multi-branch garages know which site to attend.",
      "Event-driven messages (a booking confirmation, an invoice) come from the branch where the work happens; scheduled reminders come from the customer's home branch.",
    ].join("\n"),
  },
  {
    id: "reports-and-audit",
    title: "Reports, revenue and the audit log",
    keywords: ["report", "revenue", "vat", "export", "audit", "history", "who did"],
    body: [
      "Revenue and Reports cover takings, VAT, aged debt, labour productivity and bay utilisation for the active branch. Accountants see these across all branches.",
      "Every staff action that changes data is recorded in the audit log (Settings-side, permission-gated) — useful for 'who changed this booking?' questions.",
    ].join("\n"),
  },
  {
    id: "feature-requests",
    title: "Feature requests and bug reports",
    keywords: ["feature request", "suggestion", "idea", "bug", "roadmap", "planned"],
    body: [
      "Raise feature requests and bug reports right here in the support widget — choose the matching type when you raise the ticket. Feature requests are reviewed by the AI Garage team; ones we adopt are marked 'planned' and you'll see status updates on your ticket.",
      "The more concrete the request (what you were doing, what got in the way), the faster we can act on it.",
    ].join("\n"),
  },
  {
    id: "billing-tiers",
    title: "Your AI Garage subscription",
    keywords: ["billing", "subscription", "tier", "price", "upgrade", "trial", "invoice for the platform"],
    body: [
      "Your AI Garage subscription is managed in Settings → Billing (owners/admins), separate from your customers' invoices. Plan changes take effect from the next billing period.",
      "For pricing questions or plan changes we can't answer here, raise a ticket and the team will help directly.",
    ].join("\n"),
  },
  {
    id: "prelive-go-live",
    title: "Prelive mode and going live",
    keywords: [
      "prelive",
      "pre live",
      "go live",
      "golive",
      "not sending",
      "no reminders",
      "nothing sent",
      "test mode",
      "practice",
      "first day",
      "import safely",
      "import without sending",
      "old system",
      "chase old invoices",
      "overdue before go live",
      "switch on",
    ],
    body: [
      "A new branch starts prelive: it holds your real data and behaves normally, but nothing automatic reaches a customer. That's the safe window to import your old system's data, load history, raise practice jobs and get your settings right. A blue strip at the top of the staff portal says the branch is prelive, and the branch switcher shows a PRELIVE chip.",
      "Held while prelive: MOT, service and tax reminders, booking confirmations, overdue invoice chasers, feedback requests, deferred-work follow-ups and quote reminders. Still sent: anything a staff member presses send on (a quote, an invoice, a campaign), the weekly owner digest, password resets and staff invites — so you can test as you go. Prelive overrides every toggle on the Automations page, so if an automation is on but nothing is sending, this is usually why; the settings are kept and take effect at go-live.",
      "The Go live screen (Prelive strip → 'What's waiting', or /staff/go-live) lists exactly what is waiting, grouped by type with examples, so the first day's post is visible before it's committed to. Two controls sit there: a limit on how many messages go out in the 24 hours after going live — anything over it isn't dropped, it goes on the next run so a big import drains over a few days — and whether invoices that were already overdue before go-live are chased at all, which is off by default because old debt is often settled off-system or disputed.",
      "Only the account owner can take a branch live, and it can't be undone from that screen; afterwards, individual automations can be switched off in Automations. Prelive is per branch, so opening a second site never disturbs the first one's customers. Branches that were already running before this feature existed are live and unaffected.",
      "Prelive is not the same as the sample-data sandbox: the sandbox is fake data to practise on, prelive is your real data with the outbound messages held.",
    ].join("\n"),
  },
  {
    id: "supplier-ordering",
    title: "Ordering parts from suppliers",
    keywords: [
      "supplier",
      "parts order",
      "purchase order",
      "punch out",
      "punchout",
      "catalogue link",
      "order email",
      "trade account",
      "confirmation",
      "factor",
      "gsf",
      "euro car parts",
    ],
    body: [
      "Each supplier on the Suppliers page can be set up for ordering (per branch, owners/admins and staff with product access). The Ordering badge on the supplier's row shows how orders reach them: an order email, a catalogue link (punch-out), both, off, or not set up yet.",
      "With an order email set, 'Send to supplier' on a draft purchase order sends the order for you — it names the branch that placed it, your trade account number, your PO reference and the line table — and the PO moves to Ordered. With only a catalogue link, you get an 'Open supplier basket' link instead: nothing has been sent, the PO stays a draft, so finish the order on the supplier's own site and then use 'Mark ordered'. The catalogue link can carry {reg} and {query}, which are filled in with the vehicle and the part you're searching for.",
      "When the supplier replies, 'Import confirmation' takes their confirmation email or printout pasted in as text. It reads their order reference and the confirmed unit costs and updates the matching purchase-order lines, matching on part number first and then on description. Totals and VAT lines are ignored, and any line it can't match confidently is reported rather than guessed at — so the count it gives you tells you whether anything needs a manual check. The pasted text is kept, so a bad read can be looked at again.",
      "There is no live stock or price lookup from a supplier yet, and no automatic order acknowledgement — this manual route is designed to work with any factor. Trade-API connections to specific suppliers are planned; if you want yours connected, raise a feature request naming the factor and your account.",
      "Any credentials entered for a supplier are encrypted and can never be read back, only replaced.",
    ].join("\n"),
  },
  {
    id: "data-protection",
    title: "Customer data, GDPR and retention",
    keywords: ["gdpr", "privacy", "delete customer", "data protection", "retention", "dpa"],
    body: [
      "Customer personal data belongs to your organisation; AI Garage processes it under the Data Processing Agreement accepted in Settings → Compliance. Data retention length is configurable per organisation.",
      "GDPR actions (export or erase a customer) are owner/admin-gated. Erasure is permanent — invoices are retained in anonymised form where legally required.",
    ].join("\n"),
  },
];
