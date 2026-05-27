// Permission catalogue + system role presets.
// Mirrors the system role_templates seeded in
// supabase/migrations/20260527000000_team_roles_permissions.sql. Keep in sync.

export type Permissions = {
  // Operational
  bookings: boolean;
  customers: boolean;
  reminders: boolean;
  fleet: boolean;
  products: boolean;
  notifications: boolean;

  // Financial
  revenue: boolean;            // see margin/cost
  invoices: boolean;           // create/send/mark paid
  reports: boolean;            // analytics dashboards

  // Quote lifecycle (DVI + standalone)
  quotes_draft: boolean;       // create + edit drafts
  quotes_send: boolean;        // mint customer link + email
  quotes_approve_view: boolean; // see customer responses / deposit status

  // Catalogue / config
  services: boolean;
  bays: boolean;
  automations: boolean;
  campaigns: boolean;
  org_settings: boolean;       // branding, hours, validity days, deposit %

  // Sensitive / regulated
  staff_manage: boolean;       // invite, edit roles, edit templates
  audit_log: boolean;          // view org audit trail
  gdpr_actions: boolean;       // delete / anonymize / export customer data
  stripe_connect: boolean;     // banking integration
  xero_integration: boolean;   // accounts integration

  // MOT (DVSA MTS is external; this is metadata)
  mot_records: boolean;
};

export type PermissionKey = keyof Permissions;

export type PermissionGroup = {
  label: string;
  keys: PermissionKey[];
};

export const PERMISSION_GROUPS: PermissionGroup[] = [
  { label: "Operational", keys: ["bookings", "customers", "reminders", "fleet", "products", "notifications"] },
  { label: "Financial", keys: ["revenue", "invoices", "reports"] },
  { label: "Quotes", keys: ["quotes_draft", "quotes_send", "quotes_approve_view"] },
  { label: "Catalogue & config", keys: ["services", "bays", "automations", "campaigns", "org_settings"] },
  { label: "Sensitive / regulated", keys: ["staff_manage", "audit_log", "gdpr_actions", "stripe_connect", "xero_integration"] },
  { label: "MOT", keys: ["mot_records"] },
];

export const PERMISSION_LABELS: Record<PermissionKey, { label: string; desc: string }> = {
  bookings:           { label: "Bookings",                 desc: "Create, edit and cancel bookings" },
  customers:          { label: "Customers",                desc: "Add and manage customer records" },
  reminders:          { label: "Reminders",                desc: "Send reminders to customers" },
  fleet:              { label: "Fleet",                    desc: "Manage fleet accounts and vehicles" },
  products:           { label: "Products",                 desc: "Manage parts catalogue and stock" },
  notifications:      { label: "Notifications",            desc: "Read in-app notifications" },
  revenue:            { label: "Revenue & margin",         desc: "See cost / margin on invoices and reports" },
  invoices:           { label: "Invoices",                 desc: "Create, send and mark invoices paid" },
  reports:            { label: "Reports",                  desc: "Analytics dashboards" },
  quotes_draft:       { label: "Quotes — draft",           desc: "Create and edit quote drafts (DVI + standalone)" },
  quotes_send:        { label: "Quotes — send",            desc: "Mint customer link and email the quote" },
  quotes_approve_view:{ label: "Quotes — responses",       desc: "See customer responses and deposit status" },
  services:           { label: "Services catalogue",       desc: "Configure the service offering" },
  bays:               { label: "Bays",                     desc: "Set up workshop bays" },
  automations:        { label: "Automations",              desc: "Configure automated workflows" },
  campaigns:          { label: "Campaigns",                desc: "Send bulk marketing messages" },
  org_settings:       { label: "Organisation settings",    desc: "Branding, hours, quote validity, deposit %" },
  staff_manage:       { label: "Manage team",              desc: "Invite, edit roles, manage templates" },
  audit_log:          { label: "Audit log",                desc: "View the append-only action trail" },
  gdpr_actions:       { label: "GDPR actions",             desc: "Anonymise, hard-delete or export customer data" },
  stripe_connect:     { label: "Stripe / banking",         desc: "Connect and manage the Stripe account" },
  xero_integration:   { label: "Xero integration",         desc: "Connect and manage Xero" },
  mot_records:        { label: "MOT records",              desc: "View MOT history (DVSA MTS data is external)" },
};

// Permissions whose enforcement is locked to owners/admins regardless of any
// template override — these are too sensitive to delegate via tick-box.
export const HARD_OWNER_ADMIN_PERMS: PermissionKey[] = [
  "staff_manage",
  "org_settings",
  "gdpr_actions",
];

const allFalse: Permissions = {
  bookings: false, customers: false, reminders: false, fleet: false,
  products: false, notifications: false,
  revenue: false, invoices: false, reports: false,
  quotes_draft: false, quotes_send: false, quotes_approve_view: false,
  services: false, bays: false, automations: false, campaigns: false, org_settings: false,
  staff_manage: false, audit_log: false, gdpr_actions: false,
  stripe_connect: false, xero_integration: false,
  mot_records: false,
};

// In-sync mirror of the system templates seeded in the migration.
// Used as a fallback when role_templates query fails or for offline UI.
export const DEFAULT_PERMISSIONS: Record<string, Permissions> = {
  manager: {
    ...allFalse,
    bookings: true, customers: true, reminders: true, fleet: true, products: true, notifications: true,
    revenue: true, invoices: true, reports: true,
    quotes_draft: true, quotes_send: true, quotes_approve_view: true,
    services: true, bays: true, automations: true, campaigns: true,
    audit_log: true, mot_records: true,
  },
  service_advisor: {
    ...allFalse,
    bookings: true, customers: true, reminders: true, fleet: true, products: true, notifications: true,
    invoices: true, reports: true,
    quotes_draft: true, quotes_send: true, quotes_approve_view: true,
    mot_records: true,
  },
  mechanic: {
    ...allFalse,
    bookings: true, customers: true, fleet: true, products: true, notifications: true,
    quotes_draft: true, quotes_approve_view: true,
    mot_records: true,
  },
  apprentice: {
    ...allFalse,
    bookings: true, customers: true, products: true, notifications: true,
    mot_records: true,
  },
  receptionist: {
    ...allFalse,
    bookings: true, customers: true, reminders: true, fleet: true, notifications: true,
    invoices: true, quotes_approve_view: true,
    mot_records: true,
  },
  parts: {
    ...allFalse,
    products: true, notifications: true,
    revenue: true, reports: true,
  },
  bookkeeper: {
    ...allFalse,
    notifications: true,
    revenue: true, invoices: true, reports: true, quotes_approve_view: true,
    audit_log: true, stripe_connect: true, xero_integration: true,
  },
  staff: {
    ...allFalse,
    bookings: true, customers: true, reminders: true, fleet: true, products: true, notifications: true,
    mot_records: true,
  },
};

export const DEFAULT_PERMS: Permissions = DEFAULT_PERMISSIONS.staff;

// Fill missing keys on a stored permission blob so older rows (pre-migration)
// don't crash UI that assumes every key is present.
export function normalisePermissions(p: Partial<Permissions> | null | undefined): Permissions {
  return { ...allFalse, ...(p ?? {}) };
}
