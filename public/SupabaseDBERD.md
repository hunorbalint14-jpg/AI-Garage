# AI Garage — Supabase ERD

Visual reference for the AI Garage Postgres schema (on Supabase). Tables
are grouped by domain. Foreign keys are listed under each table; the
Mermaid diagram below renders relationships at a glance.

> Tenant scope: every operational table carries a `location_id` (and most
> also a derived `organization_id` via the location). Row-level security
> policies enforce membership.

---

## Entity relationship diagram

```mermaid
erDiagram
    organizations ||--o{ locations               : "owns"
    organizations ||--o{ org_users               : "members"
    organizations ||--o{ audit_log               : "audited"
    organizations ||--o{ doc_shares              : "scopes"
    organizations ||--o{ xero_payouts            : "receives"

    locations     ||--o{ location_users          : "staff"
    locations     ||--o{ customers               : "has"
    locations     ||--o{ vehicles                : "has"
    locations     ||--o{ bookings                : "schedules"
    locations     ||--o{ jobs                    : "runs"
    locations     ||--o{ invoices                : "bills"
    locations     ||--o{ bays                    : "physical"
    locations     ||--o{ services                : "offers"
    locations     ||--o{ products                : "stocks"
    locations     ||--o{ reminders               : "sends"
    locations     ||--o{ scheduled_tasks         : "automates"
    locations     ||--o{ fleet_companies         : "manages"
    locations     ||--o{ tyre_checks             : "records"
    locations     ||--o{ data_deletion_log       : "audits"

    customers     ||--o{ vehicles                : "owns"
    customers     ||--o{ bookings                : "books"
    customers     ||--o{ jobs                    : "subject"
    customers     ||--o{ invoices                : "billed"
    customers     ||--o{ reminders               : "receives"
    customers     ||--o{ data_deletion_log       : "erased"
    fleet_companies ||--o{ customers             : "groups"

    vehicles      ||--o{ bookings                : "for"
    vehicles      ||--o{ jobs                    : "for"
    vehicles      ||--o{ reminders               : "about"
    vehicles      ||--o{ tyre_checks             : "checked"

    bookings      ||--o| jobs                    : "spawns"
    bookings      ||--o| invoices                : "prepays"
    bays          ||--o{ bookings                : "occupies"
    services      ||--o{ bookings                : "type"

    jobs          ||--o{ job_items               : "lines"
    jobs          ||--o| invoices                : "bills"

    auth_users[auth.users] ||--o{ org_users      : "is"
    auth_users[auth.users] ||--o{ location_users : "is"
    auth_users[auth.users] ||--o{ customers      : "logs in as"
    auth_users[auth.users] ||--o{ webauthn_credentials : "has"
    auth_users[auth.users] ||--o{ audit_log      : "acts"
    auth_users[auth.users] ||--o{ doc_shares     : "mints"
```

---

## Domain 1 · Identity & Tenancy

The platform is multi-tenant: each garage is one `organization` which
owns one or more `locations` (each a unique subdomain). Staff are scoped
to either the whole org (`org_users`) or a single location
(`location_users`). End customers live on a specific location.

### `organizations`

The top-level tenant. Holds brand identity, Stripe + Xero connections,
and compliance flags (DPA, retention).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `slug` | `text` | Unique. Used for branded subdomains / lookups. |
| `name` | `text` | Display name. |
| `primary_color` | `text` | Hex (e.g. `#22c55e`). Drives all branded surfaces. |
| `logo_url` | `text` | Nullable. Storage URL. |
| `custom_domain` | `text` | Nullable, unique. Alternative to subdomain. |
| `phone` | `text` | Nullable. Used in reminder copy. |
| `portal_theme` | `text` | UI theme key for customer portal. |
| `google_review_url` | `text` | Nullable. Surfaced on review prompts. |
| `privacy_policy_url` | `text` | Nullable. Per-tenant override of `/privacy`. |
| `data_retention_years` | `int2` | Drives auto-prune of historical comms. |
| `dpa_accepted_at` / `_by_user_id` / `_version` | `timestamptz` / `uuid` / `text` | Per-org DPA acceptance. |
| `stripe_account_id` | `text` | Nullable. Connect Express account id. |
| `stripe_charges_enabled` / `_payouts_enabled` / `_details_submitted` | `bool` | Status flags from Stripe `account.updated`. |
| `xero_tenant_id` / `_tenant_name` | `text` | Connected Xero org. |
| `xero_access_token` / `_refresh_token` | `text` | **Encrypted at application layer (AES-256-GCM) via `lib/encryption.ts`.** |
| `xero_token_expires_at` / `_connected_at` | `timestamptz` | |
| `created_at` | `timestamptz` | |

### `locations`

A single physical garage. Tenant boundary for almost all operational
data. Slug becomes the customer-facing subdomain.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `organization_id` | `uuid` | → `organizations.id` |
| `slug` | `text` | Unique. Drives `<slug>.ai-garage.co.uk`. |
| `name` | `text` | |
| `business_hours` | `jsonb` | Per-weekday opening hours: `{ "<0=Sun..6=Sat>": { "open": <min from midnight>, "close": <min> } }`. Missing weekday = closed. Default Mon–Sat 08:00–18:00. Gates the booking widget + AI receptionist; see `src/lib/business-hours.ts`. |
| `created_at` | `timestamptz` | |

### `location_special_hours`
One-off date overrides (bank holidays, special opening). A row for a date wins over the weekly `business_hours`.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `organization_id` | `uuid` | → `organizations.id` (backfilled from `location_id`) |
| `location_id` | `uuid` | → `locations.id` |
| `date` | `date` | Unique per `(location_id, date)`. |
| `is_closed` | `bool` | Closed all day. |
| `open_minute` / `close_minute` | `int2` | Custom hours (minutes from midnight) when not closed. |
| `note` | `text` | e.g. "Christmas Day". |

### `org_users`

Org-level staff membership (owners + admins). Reaches every location in
the org.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `user_id` | `uuid` | → `auth.users.id` |
| `organization_id` | `uuid` | → `organizations.id` |
| `role` | `text` | `owner` \| `admin` |
| `created_at` | `timestamptz` | |

### `location_users`

Location-level staff membership (mechanics, receptionists). Scoped to a
single location.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `user_id` | `uuid` | → `auth.users.id` |
| `location_id` | `uuid` | → `locations.id` |
| `role` | `text` | `staff` |
| `permissions` | `jsonb` | Per-feature flags. |
| `created_at` | `timestamptz` | |

### `customers`

End customer of a garage. Optionally linked to `auth.users` once they
log in to the portal.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `location_id` | `uuid` | → `locations.id` |
| `user_id` | `uuid` | Nullable. → `auth.users.id` once they sign in. |
| `full_name` / `email` / `phone` | `text` | |
| `fleet_company_id` | `uuid` | Nullable. → `fleet_companies.id`. |
| `marketing_email_consent` / `_sms_consent` | `bool` | Enforced by broadcast paths. |
| `consent_updated_at` | `timestamptz` | |
| `anonymized_at` | `timestamptz` | Set on GDPR erasure. |
| `xero_contact_id` | `text` | Cached after first sync. |
| `created_at` | `timestamptz` | |

### `webauthn_credentials`

Passkeys for staff re-auth on sensitive surfaces.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `user_id` | `uuid` | → `auth.users.id` |
| `credential_id` | `text` | Unique. |
| `public_key` | `text` | Base64 (text column, not bytea). |
| `counter` | `int8` | Anti-clone. |
| `transports` | `text[]` | |
| `device_name` | `text` | User-supplied label. |
| `created_at` / `last_used_at` | `timestamptz` | |

---

## Domain 2 · Operations (bookings, jobs, vehicles)

The actual day-to-day garage workflow. A `booking` becomes a `job` when
work starts; a completed job spawns an `invoice`. A `booking` can also
be paid up-front via the public widget — in that case it produces a
paid invoice directly (no job needed yet).

### `vehicles`

Customer's car. The mot/service/tax columns drive the reminder pipeline.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `location_id` | `uuid` | → `locations.id` |
| `customer_id` | `uuid` | → `customers.id` |
| `registration` | `text` | UK plate. |
| `make` / `model` / `year` | `text` / `text` / `int4` | |
| `mot_expiry` | `date` | Nullable. |
| `service_due` | `date` | Nullable. |
| `tax_due_date` | `date` | Nullable. |
| `recall_status` / `_checked_at` / `_detail` | `text` / `timestamptz` / `text` | DVSA recall flag + JSON detail. |
| `created_at` | `timestamptz` | |

### `bays`

Physical service bays. Bookings are assigned a bay; double-booking is
blocked at server-side (`isBayFreeAt`).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `location_id` | `uuid` | → `locations.id` |
| `name` | `text` | e.g. "Bay 1". |
| `description` | `text` | Nullable. |
| `sort_order` | `int4` | |

### `services`

Per-location service catalogue. Drives the booking widget dropdown.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `location_id` | `uuid` | → `locations.id` |
| `name` / `category` | `text` | |
| `description` | `text` | Nullable. |
| `price` | `numeric` | Nullable. Set → booking widget collects payment upfront. |
| `duration_minutes` | `int4` | Nullable. |
| `vat_included` | `bool` | Affects invoice maths. |
| `active` | `bool` | |
| `created_at` | `timestamptz` | |

### `bookings`

Customer-facing booking record.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `location_id` | `uuid` | → `locations.id` |
| `customer_id` | `uuid` | → `customers.id` |
| `vehicle_id` | `uuid` | Nullable. → `vehicles.id` |
| `bay_id` | `uuid` | Nullable. → `bays.id` |
| `service_id` | `uuid` | Nullable. → `services.id` |
| `scheduled_at` | `timestamptz` | |
| `duration_minutes` | `int4` | Default 60. |
| `type` | `text` | Service category snapshot. |
| `notes` | `text` | Nullable. |
| `status` | `text` | `payment_pending` \| `scheduled` \| `in_progress` \| `complete` \| `cancelled` \| `no_show` |
| `stripe_checkout_session_id` / `_payment_intent_id` | `text` | Set when booking was prepaid via Checkout. |
| `paid_at` / `paid_amount_pence` | `timestamptz` / `int4` | Set after Stripe webhook confirms. |
| `created_at` | `timestamptz` | |

### `jobs`

Work-in-progress record. Spawned from a booking when staff hits "Start".

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `location_id` | `uuid` | → `locations.id` |
| `customer_id` | `uuid` | → `customers.id` |
| `vehicle_id` | `uuid` | Nullable. → `vehicles.id` |
| `booking_id` | `uuid` | Nullable. → `bookings.id` |
| `status` | `text` | `open` \| `complete` \| `invoiced` |
| `description` / `notes` | `text` | |
| `completed_at` | `timestamptz` | Nullable. |
| `created_at` | `timestamptz` | |

### `job_items`

Line items on a job — drives invoice generation.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `job_id` | `uuid` | → `jobs.id` |
| `description` | `text` | |
| `type` | `text` | `labour` \| `part` |
| `quantity` | `numeric` | |
| `unit_price` | `numeric` | |
| `created_at` | `timestamptz` | |

### `products`

Parts inventory for a location.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `location_id` | `uuid` | → `locations.id` |
| `name` / `category` / `sku` / `supplier` | `text` | |
| `unit_price` / `cost_price` | `numeric` | |
| `stock_qty` / `reorder_at` | `int4` | |
| `active` | `bool` | |
| `created_at` | `timestamptz` | |

### `tyre_checks`

Per-vehicle tyre tread record.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `vehicle_id` | `uuid` | → `vehicles.id` |
| `location_id` | `uuid` | → `locations.id` |
| `checked_at` | `date` | |
| `nsf_depth` / `osf_depth` / `nsr_depth` / `osr_depth` | `numeric` | Tread, mm. |
| `nsf_replaced` / `osf_replaced` / `nsr_replaced` / `osr_replaced` | `bool` | |
| `notes` | `text` | |

### `fleet_companies`

Business customers that group multiple end-customers.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `location_id` | `uuid` | → `locations.id` |
| `name` / `contact_name` / `contact_email` / `contact_phone` | `text` | |
| `notes` | `text` | |

---

## Domain 3 · Money (invoices, payouts)

Customer pays the garage via Stripe Connect (Express). The invoice is
mirrored to the garage's Xero. When Stripe pays the garage's bank, the
payout is mirrored as a Xero bank transaction for reconciliation.

### `invoices`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `location_id` | `uuid` | → `locations.id` |
| `customer_id` | `uuid` | → `customers.id` |
| `job_id` | `uuid` | Nullable. → `jobs.id` (job invoice) |
| `booking_id` | `uuid` | Nullable. → `bookings.id` (prepay invoice) |
| `invoice_number` | `text` | Per-location sequence. |
| `status` | `text` | `draft` \| `sent` \| `paid` \| `overdue` (computed) |
| `subtotal` / `vat_rate` / `vat_amount` / `total` | `numeric` | UK VAT @ 20%. |
| `issued_at` / `due_at` / `paid_at` | `date` / `date` / `timestamptz` | |
| `notes` | `text` | |
| `stripe_checkout_session_id` / `_payment_intent_id` | `text` | |
| `stripe_paid_at` / `_paid_amount_pence` | `timestamptz` / `int4` | Webhook-populated. |
| `xero_invoice_id` / `xero_payment_id` / `xero_synced_at` | `text` / `text` / `timestamptz` | Set after Xero push. |
| `created_at` | `timestamptz` | |

### `xero_payouts`

Idempotency tracker for the `payout.paid` → Xero bank-transaction sync.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `organization_id` | `uuid` | → `organizations.id` |
| `stripe_payout_id` | `text` | **Unique with `organization_id`.** |
| `stripe_account_id` | `text` | Connected account that paid out. |
| `xero_bank_transaction_id` | `text` | Set after Xero `BankTransaction` posted. |
| `amount_pence` | `int4` | Net payout. |
| `arrival_date` | `date` | From Stripe. Used as Xero date. |
| `pushed_at` | `timestamptz` | |

---

## Domain 4 · Communications (reminders, scheduling)

Outbound messaging engine. Email (Resend), SMS (Twilio), WhatsApp
(Twilio). Reminders are deduplicated per (vehicle, type, channel) over
30 days. Scheduled tasks orchestrate the daily fan-out.

### `reminders`

One row per channel per send.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `location_id` | `uuid` | → `locations.id` |
| `customer_id` | `uuid` | → `customers.id` |
| `vehicle_id` | `uuid` | Nullable. → `vehicles.id` |
| `type` | `text` | `mot` \| `service` \| `tax` \| `campaign` \| `custom` |
| `channel` | `text` | `email` \| `sms` \| `whatsapp` |
| `recipient_email` / `recipient_phone` | `text` | |
| `subject` / `message_text` | `text` | |
| `status` | `text` | `sent` \| `failed` \| `bounced` |
| `error_message` | `text` | Provider error string. |
| `sent_at` | `timestamptz` | |
| `delivered_at` / `opened_at` / `clicked_at` | `timestamptz` | Email-only, populated by Resend webhook. |
| `resend_email_id` | `text` | Used by the webhook to find the row. |

### `scheduled_tasks`

Per-location cron config. Hourly `/api/cron/tick` runs anything due.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `location_id` | `uuid` | → `locations.id` |
| `task_type` | `text` | `mot_reminders` \| `service_reminders` \| `tax_reminders` \| `weekly_digest` \| etc. |
| `enabled` | `bool` | |
| `frequency` | `text` | `daily` \| `weekly` |
| `hour` | `int2` | 0–23 |
| `day_of_week` | `int2` | 0–6 (Sun=0). Weekly only. |
| `settings` | `jsonb` | Per-task config (channels, remind_days_before, …). |
| `last_run_at` / `next_run_at` | `timestamptz` | |

---

## Domain 5 · Compliance & Sharing

Forensic trail, GDPR erasure log, and signed-link doc shares.

### `audit_log`

Append-only record of sensitive staff actions. Rows can be read by org
owners + admins; INSERT only via service role; no UPDATE or DELETE
policy at all.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `organization_id` | `uuid` | Nullable (NULL for platform-scope events). |
| `actor_user_id` | `uuid` | Nullable. → `auth.users.id` |
| `actor_email` | `text` | Snapshot at action time. |
| `action` | `text` | `settings.update` / `stripe.connect_complete` / `xero.connect_complete` / `xero.disconnect` / `dpa.accept` / `doc_share.mint` / `doc_share.revoke` / `impersonation.start` / `impersonation.stop` / … |
| `entity_type` | `text` | e.g. `organization`, `stripe_account`, `doc_share`. |
| `entity_id` | `text` | The id of the affected entity. |
| `metadata` | `jsonb` | Free-form context per action. |
| `ip_address` / `user_agent` | `text` | Captured from request headers. |
| `created_at` | `timestamptz` | |

### `data_deletion_log`

GDPR erasure audit. One row per anonymisation pass.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `location_id` | `uuid` | → `locations.id` |
| `customer_id` | `uuid` | Nullable (FK preserved even after row scrub). |
| `customer_email_hash` | `text` | SHA-256 of original email — proof-of-erasure. |
| `reason` | `text` | |
| `requested_by` | `uuid` | Nullable. → `auth.users.id` |
| `notes` | `text` | Nullable. |
| `deleted_at` | `timestamptz` | |

### `doc_shares`

Signed-link gates for internal HTML docs (technical reference,
runbooks). One row per share. Token is stored as SHA-256 hash only.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `organization_id` | `uuid` | Nullable (platform-scope shares = NULL). |
| `doc_key` | `text` | e.g. `technical`. Mapped to file path by the route. |
| `slug` | `text` | Unique. Public path segment. |
| `token_hash` | `text` | **SHA-256 hex.** Raw token shown to staff once on mint. |
| `label` | `text` | Internal note. |
| `expires_at` | `timestamptz` | Nullable. |
| `max_views` | `int4` | Nullable. |
| `view_count` | `int4` | Bumped atomically via SECURITY DEFINER RPC. |
| `last_viewed_at` | `timestamptz` | |
| `created_by` | `uuid` | → `auth.users.id` |
| `created_at` | `timestamptz` | |
| `revoked_at` | `timestamptz` | Nullable. |
| `revoked_by` | `uuid` | Nullable. → `auth.users.id` |

---

## Notable cross-domain column groupings

| Concern | Tables | Columns |
|---|---|---|
| Branding | `organizations` | `slug`, `name`, `primary_color`, `logo_url`, `custom_domain`, `portal_theme` |
| Compliance | `organizations`, `customers`, `data_deletion_log` | `dpa_accepted_at`, `dpa_version`, `data_retention_years`, `marketing_*_consent`, `anonymized_at`, `customer_email_hash` |
| Stripe | `organizations`, `invoices`, `bookings` | `stripe_account_id`, `stripe_*_enabled`, `stripe_checkout_session_id`, `stripe_payment_intent_id`, `paid_amount_pence` |
| Xero | `organizations`, `customers`, `invoices`, `xero_payouts` | `xero_tenant_id`, `xero_access_token`/`_refresh_token` (encrypted), `xero_contact_id`, `xero_invoice_id`, `xero_payment_id`, `xero_synced_at` |
| Audit | `audit_log`, `data_deletion_log`, `doc_shares` | `actor_user_id`, `actor_email`, `created_at`, `revoked_at`, `revoked_by`, `last_viewed_at`, `view_count` |

Generated against schema as of 2026-05-19. Bump after adding tables.
