# Account customers — build spec (#504)

Trade and fleet customers (driving schools, taxi firms, local businesses)
expect account billing: work accrues on terms, one consolidated invoice at
month end, statements with aging, credit control. GDS/MAM treat this as
decades-old core; we invoice every job individually and chase each one.

**Architecture in one line: an account flag + terms on the customer, a
`payments` ledger with oldest-first allocation, consolidated invoices as
normal `invoices` rows joined to their jobs via `invoice_jobs`, and
statements computed from the ledger — no parallel billing system.**

Everything downstream (invoice numbering #513, VAT #514, dunning cron, Xero
sync, branded emails, the customer portal) is reused, not forked.

## Data model (PR 2)

```sql
customers:
  account_customer      boolean not null default false,
  payment_terms_days    integer not null default 30,   -- due_at = issued + terms
  credit_limit          numeric(10,2),                 -- null = no limit
  consolidated_billing  boolean not null default false -- jobs accrue for month-end

-- Consolidated invoice ↔ member jobs (line-per-job on the rendered invoice:
-- date, reg, job description, net amount).
invoice_jobs (
  id, invoice_id references invoices on delete cascade,
  job_id references jobs on delete restrict,   -- a billed job can't vanish
  amount numeric(10,2) not null,               -- ex-VAT job total at billing
  unique (job_id)                              -- a job is consolidated once
)

-- Account payments ledger (bank transfer / cheque / card-on-account) with
-- oldest-first allocation. Stripe per-invoice payments stay as they are.
payments (
  id, location_id, organization_id,            -- financial scoping like invoices
  customer_id references customers,
  amount numeric(10,2) not null,
  method text check (method in ('bank_transfer','card','cash','cheque','other')),
  reference text, received_at date not null default current_date,
  recorded_by uuid references auth.users,
  created_at
)
payment_allocations (
  id, payment_id references payments on delete cascade,
  invoice_id references invoices on delete restrict,
  amount numeric(10,2) not null
)
invoices: amount_paid numeric(10,2) not null default 0   -- allocation rollup
          (status 'paid' when amount_paid >= total; partials stay 'sent')
```

RLS: financial pattern (branch members OR org finance) for `payments`/
`payment_allocations`/`invoice_jobs`, matching invoices.

## PR plan

### PR 2 — account flag, balance, credit control (M)
- Customer page "Account" section (owner/admin/finance): account toggle,
  terms days, credit limit, consolidated-billing toggle. Audit-logged.
- **Balance header** on the customer page: open invoiced £ (sent −
  allocations) + unbilled completed-job £ for consolidated accounts.
- **Over-limit warning** at booking creation and job creation when
  balance + new work would breach the limit: org-configurable
  `credit_control_mode` ('warn' default | 'block'). Warn is a banner;
  block still allows owner/admin override — core trading is never hard-gated
  by our defaults, the org chooses.
- Invoice creation for account customers: `due_at = issued + terms` (today
  it's the org-wide default).

### PR 3 — consolidated month-end run (L)
- "Raise consolidated invoice" on the account customer (period picker,
  default last calendar month): rolls the period's **completed, uninvoiced**
  jobs into ONE invoice — line per job (date · reg · description · net),
  per-line VAT carried from the job lines (#514 maths), `invoice_jobs` rows,
  member jobs flip to `invoiced`. Idempotent: a job already in
  `invoice_jobs` can never be billed twice (unique constraint).
- Org-wide "Run month end" action (staff, manual) that does this for every
  consolidated account with billable jobs; a `consolidated_billing`
  scheduled task on the tick fan-out can follow once manual proves out
  (same lazy seeding pattern; explicitly opt-in).
- Invoice render/email: existing shell; the line table comes from
  `invoice_jobs` when `job_id is null` + `invoice_jobs` exist.

### PR 4 — payments ledger, statements, dunning terms (L)
- **Record payment** on the account customer (amount, method, reference,
  date) → oldest-first allocation across open invoices (pure allocator,
  unit-tested; overpayment stays unallocated on the payment and reports as
  credit on the statement). Invoice `amount_paid` rollup; `paid` when
  covered; audit.
- **Statement** (on-demand from the customer page): opening balance, the
  period's invoices and payments, closing balance, aging buckets (current /
  30 / 60 / 90 — reuse `summariseAgedDebtors`). Rendered as a print-CSS page
  + emailed through the branded shell. Totals reconcile with invoices to the
  penny (pure builder, unit-tested against the allocator).
- **Dunning respects terms**: the dunning cron skips invoices still inside
  the customer's `payment_terms_days` and dunns the account contact once
  per overdue statement cycle rather than per invoice.

### PR 5 — fleet portal view (S, stretch)
- The account contact's portal dashboard gains "Your account": vehicles'
  jobs, open balance, statements. Cut first if the epic needs trimming —
  competitors mostly email PDFs; we already have a portal.

## Explicit MVP cuts

- Automated month-end cron (manual run ships first; task type reserved).
- Credit application workflow / approval chains.
- Interest on overdue balances; multi-currency.
- Xero: consolidated invoices sync as normal invoices (line detail flattened)
  — deeper mapping later.

## Risks / repo gotchas

- Part-payments change what "paid" means everywhere `status='paid'` is read
  (reports, dashboards, revenue): rollout keeps `paid` = fully covered, so
  existing reads stay correct; partials remain `sent` with `amount_paid`.
- Aged debtors currently reads `status='sent'` — statements/aging must use
  `total − amount_paid`, not raw totals (update `summariseAgedDebtors`
  call sites in PR 4).
- `invoice_jobs.job_id on delete restrict`: deleting a billed job must fail
  loudly, not orphan an invoice line.
- Migration numbering; lazy-builder `.then()`; branch identity on statement
  emails; hint any new double-FK embeds.

## Acceptance (from #504, restated)

1. Consolidated account's completed jobs accrue unbilled; month-end run
   produces one invoice (line per job, reg on each line); a job can't be
   billed twice. (PR 3)
2. Part-payments allocate oldest-first; the statement matches invoice totals
   to the penny with aging buckets. (PR 4)
3. Over-limit warning fires on new booking/job; dunning respects account
   terms. (PRs 2 + 4)

## Sizing

| PR | Scope | Size |
|---|---|---|
| 1 | This spec | — |
| 2 | Schema + account section + balance + credit control | M |
| 3 | Consolidated month-end run + invoice render | L |
| 4 | Payments ledger + statements + dunning terms | L |
| 5 | Fleet portal view (stretch) | S |
