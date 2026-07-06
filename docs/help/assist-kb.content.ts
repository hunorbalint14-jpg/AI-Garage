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
    id: "xero-sync",
    title: "Xero accounting sync",
    keywords: ["xero", "accounting", "sync", "invoice export", "bookkeeping"],
    body: [
      "Xero connects per organisation in Settings → Integrations (owners/admins). Once connected, invoices sync to Xero so your bookkeeping stays current without re-keying.",
      "If the connection expires (Xero tokens do lapse when unused), the integration shows as disconnected — reconnect from the same settings page. Historic invoices are not lost; sync resumes going forward.",
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
    id: "data-protection",
    title: "Customer data, GDPR and retention",
    keywords: ["gdpr", "privacy", "delete customer", "data protection", "retention", "dpa"],
    body: [
      "Customer personal data belongs to your organisation; AI Garage processes it under the Data Processing Agreement accepted in Settings → Compliance. Data retention length is configurable per organisation.",
      "GDPR actions (export or erase a customer) are owner/admin-gated. Erasure is permanent — invoices are retained in anonymised form where legally required.",
    ].join("\n"),
  },
];
