# Migration runbook — moving a garage onto AI Garage (#505)

The importer lives at **Customers → Import data** (`/staff/customers/import`).
Four kinds, always in this order:

1. **Customers & vehicles** — everything else matches on registration/email,
   so this goes first.
2. **Service history** — per-vehicle past work (date · mileage · description ·
   total). Stored separately from jobs; badged "imported history".
3. **Reminder dates** — MOT/service/tax due dates. Fills blanks by default;
   tick *overwrite* to replace dates a vehicle already has. The reminder
   crons pick imported dates up automatically.
4. **Past invoices** — read-only historical documents. Never touch invoice
   numbering, VAT, revenue, dunning or Xero.

Every import is **preview-first**: upload → check the column mapping (known
competitor exports auto-map) → dry-run report (what will be created + every
rejected row with its reason) → commit. A mid-commit failure rolls the whole
batch back — nothing partial is ever saved.

General file rules: **CSV only** (re-save XLSX as CSV), max 2 MB / 5,000 rows
per file (split bigger exports), UK dates (`dd/mm/yyyy`) or ISO both fine,
`£`/commas in amounts fine. If Excel re-saved the file, check it didn't
mangle registrations into formulas or dates into US format.

---

## TechMan

**Getting the export**: Reports → Data Export (or ask TechMan support for the
"customer data export" — they provide it as part of offboarding; they may
take a few days). Exports arrive as one file per entity: customers,
vehicles, documents (invoices), service history.

**Quirks**
- Some locales export **semicolon-delimited** files — the importer sniffs
  this automatically; don't re-save.
- Dates are `dd/mm/yyyy`.
- Customer and vehicle data sometimes come combined (one row per vehicle
  with the owner repeated) — that's exactly the shape the *customers &
  vehicles* kind expects; duplicate customers collapse on email.

**Maps to** (auto-detected): `Customer Name → full name`, `Email Address →
email`, `Mobile Number → phone`, `Registration → registration`, `MOT Due →
MOT expiry`, `Service Due → service due`; history: `Invoice Date → date`,
`Work Description → description`, `Invoice Total → total`; invoices:
`Invoice No / Invoice Date / Gross Total / Status`.

## Garage Hive

**Getting the export**: Garage Hive is Business Central-based — any list view
exports via *Open in Excel*; save each list as CSV. Useful lists: Customers,
Vehicles, Posted Sales Invoices, Service History.

**Quirks**
- Headers follow BC naming: `Vehicle Registration No.`, `Posting Date`,
  `Amount Including VAT`, `Document No.` — auto-detected.
- BC exports can include a currency symbol and thousands separators in
  amounts — handled.
- `E-Mail` (with the hyphen) is their email column.

## Autowork Online (AWO)

**Getting the export**: Reports → Customer / Vehicle listings → export CSV.
Invoice history comes from the Sales Reports section. If the account is
closing, MAM support can produce a full data extract — request it before the
subscription lapses or access disappears.

**Quirks**
- Column names are terse: `Cust Name`, `Reg No`, `Tel No`, `Inv Number`,
  `Inv Date`, `Inv Total` — auto-detected.
- Reg plates sometimes come without the space — matching is
  space-insensitive, no action needed.

---

## Order of operations for a real switch

1. Export everything from the old system **before** the subscription ends.
2. Import customers & vehicles → spot-check a handful on the Customers page.
3. Import service history → check a busy vehicle's history section.
4. Import reminder dates → check a couple of MOT dates on vehicle rows;
   they'll enter the normal reminder cycle from the next cron pass.
5. Import past invoices → check the customer's "Past invoices" panel.
6. Rejected rows: the preview names every one with a reason (bad date,
   unknown registration, no contact to match). Fix in the CSV and re-import
   just those rows — already-imported customers dedupe on email, vehicles
   on registration.

**These mappings are best-effort against the incumbents' documented export
shapes.** The first real switcher file from each vendor should be diffed
against the preset (`src/lib/import-presets.ts`) and the preset refined —
that's a ten-minute PR, and this runbook should be updated with anything
learned.
