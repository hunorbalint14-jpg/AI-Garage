# Accounting provider seam (#501)

One accounting connection per organisation (Xero or QuickBooks Online today;
Sage is a planned add). The seam separates *what* we sync (provider-neutral
orchestration) from *how* each vendor's API wants it (provider impls), so a
new provider is an add, not a rewrite.

## Layout — `src/lib/accounting/`

| File | Owns |
|---|---|
| `types.ts` | `AccountingProvider` interface, payload types, provider ids/labels |
| `connection.ts` | Load/save/delete connections, token decrypt + refresh, provider registry, mapping-wipe on provider switch |
| `sync.ts` | Orchestration: `pushInvoiceToAccounting`, `pushPaymentToAccounting`, `pushCreditNoteToAccounting`, `pushPayoutToAccounting`; line building; idempotency; sync log |
| `health.ts` | `getBooksHealth` — unsynced counts, failures, 30-day paid-vs-synced coverage |
| `xero-provider.ts` | xero-node client, OAuth helpers, Xero quirks (AUTHORISED status, AIG- number prefix, OUTPUT2/NONE tax types, Reference-field dedupe) |
| `quickbooks-provider.ts` | Raw v3 REST client, OAuth helpers, QBO quirks (ItemRef via a single "AI Garage Sales" service item, realm tax-code resolution, 21-char DocNumber dedupe, Undeposited Funds payments) |

## Storage

- `accounting_connections` — one row per org (`organization_id` unique).
  Tokens AES-GCM encrypted (`src/lib/encryption.ts`), RLS deny-all: service
  role only. Status reads for UI go through `getConnectionStatus` (no tokens).
- Entity mappings are provider-neutral columns: `invoices.accounting_invoice_id`
  / `accounting_payment_id` / `accounting_synced_at`,
  `customers.accounting_contact_id`, `credit_notes.accounting_credit_note_id`.
  One provider per org makes one set of columns sufficient;
  `saveAccountingConnection` wipes them when the org switches provider or
  company (reference-tag dedupe rebuilds them on a reconnect).
- `accounting_payouts` — Stripe payout → bank-transaction idempotency ledger
  (`organization_id, stripe_payout_id` unique).
- `accounting_sync_log` — one row per push attempt (`synced` / `failed` +
  error). Read by the books-health panel (Settings → Integrations); readable
  by org finance (owner/admin/accountant), written by service role.

## Idempotency model

1. Local mapping column set → skip (fast path).
2. Provider-side lookup by a deterministic key → adopt the existing record:
   - Xero: `Reference` field carries `AIG-<uuid>` (invoice numbers are NOT
     unique across a Xero org — the Demo Company seeds its own INV-#### rows).
   - QuickBooks: `PrivateNote` is not queryable, so `DocNumber`
     (`AIG-<invoice number>`, ≤21 chars) is the dedupe key; credit notes use
     `AIG-<credit number>` or a uuid-derived fallback.
3. Create, then persist the mapping + a `synced` log row.

Failures write a `failed` log row and return null — callers are
fire-and-forget. The health panel's "Retry sync now" re-pushes anything
missing inside the connection window (everything is individually idempotent).

## Adding a provider (e.g. Sage)

1. Implement `AccountingProvider` + a `refresh<Provider>Tokens` function in
   `src/lib/accounting/sage-provider.ts`.
2. Register both in `connection.ts` (`PROVIDERS`, `REFRESHERS`) and extend
   `AccountingProviderId` / `PROVIDER_LABELS` in `types.ts`; allow the value
   in the `accounting_connections.provider` check constraint (migration).
3. Add `/api/sage/connect/{begin,callback}` routes — copy the QuickBooks
   pair; the signed `oauth-state` token is the auth anchor on the apex-domain
   callback.
4. Enable the connect button in
   `src/app/staff/settings/accounting-section.tsx` and add env rows to
   `src/lib/env-checklist.ts`.

## Env

| Var | Notes |
|---|---|
| `XERO_CLIENT_ID` / `XERO_CLIENT_SECRET` | Xero OAuth app |
| `XERO_SALES_ACCOUNT_CODE` | Defaults to `200` (UK chart "Sales") |
| `QUICKBOOKS_CLIENT_ID` / `QUICKBOOKS_CLIENT_SECRET` | Intuit developer app keys |
| `QUICKBOOKS_ENVIRONMENT` | `sandbox` \| `production`; defaults to sandbox outside production builds |

QuickBooks notes: refresh tokens rotate on every refresh (always persisted)
and die after ~100 days unused; the realm (company) id arrives only on the
OAuth callback query string; sandbox and production are different hosts with
disjoint tokens. Redirect URIs registered with Intuit must match
`<origin>/api/quickbooks/connect/callback` exactly.
