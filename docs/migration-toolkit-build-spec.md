# Migration toolkit — build spec (#505)

Switching cost is the #1 objection to leaving an incumbent. TorqueFlow sells
direct TechMan imports; TechMan and GDS sell *managed* migration (£350–£1,500).
We import customers + vehicles from CSV and nothing else — a switcher loses
their history or keys it by hand. This plan closes that gap and adds the thing
nobody in the market has: AI-proposed column mapping, so any export becomes a
ten-minute self-serve job.

## Data model decisions (the load-bearing ones)

- **Service history is NOT jobs.** Imported history becomes
  `vehicle_history_entries` (vehicle_id, happened_on date, mileage, description,
  total numeric null, source `'import'`, import_batch_id) — a new table.
  Fabricating `jobs` rows would pollute the board, time-tracking, margins and
  every report with work this garage never did on our watch.
- **Imported invoices are NOT invoices.** `imported_invoices` (customer_id,
  vehicle_id null, invoice_number, issued_on, total, status text as-given,
  description, import_batch_id) — read-only historical documents, badged
  "imported history" wherever shown. Zero contact with numbering, VAT, revenue,
  dunning, Xero or the payments ledger.
- **Batches**: `import_batches` (org, location, kind, filename, row counts,
  created_by) — every imported row carries `import_batch_id`, which is what
  makes "nothing partial on failure" and a future per-batch undo cheap.
- **Reminder dates** are NOT new rows — they update `vehicles.mot_expiry` /
  `service_due` / `tax_due_date` (only filling blanks unless "overwrite"
  is ticked), so the existing MOT-delta cron and reminders fire off them
  with no new plumbing.

## Shape

### PR 1 — this spec

### PR 2 — import engine v2: history + reminders, dry-run, all-or-nothing (L)

- `src/lib/import-engine.ts` (pure core + thin IO): parse CSV (reuse+extract
  the existing parser), apply a **column mapping** (`{sourceHeader →
  targetField}`), validate row-by-row into typed rows + row-level errors
  (`Row 17: registration invalid — "ABC"`), and produce a **dry-run report**
  (creates/updates/skips per entity + every reject with a reason).
- Import kinds: `customers` (existing behaviour, now through the engine),
  `history`, `reminders` — one wizard, three target shapes.
- **All-or-nothing commit**: validate everything first; any structural failure
  aborts before writes. Row-level rejects don't block valid rows (current
  importer's behaviour, kept), but a mid-commit DB error deletes the batch's
  rows by `import_batch_id` and reports the batch as failed.
- Wizard UI at `/staff/customers/import` (replaces the single-shot form):
  upload → mapping (auto-matched headers, manual dropdowns) → **dry-run
  preview** (counts + reject table) → commit. Same permission (customers).
- Vehicle page + customer page gain a "Service history" section rendering
  `vehicle_history_entries` (imported entries badged); portal history page
  appends them below real jobs.
- Round-trip acceptance: imported MOT dates visible on the vehicle and picked
  up by the reminders window query (drive: date inside 30d → cron selects it).

### PR 3 — imported invoices + competitor presets + runbook (M)

- `imported_invoices` table + customer-page section ("Imported history"
  badge, read-only rows: number · date · total · status).
- **Presets**: `src/lib/import-presets.ts` — header-mapping dictionaries for
  TechMan, Garage Hive, Autowork Online exports (their column names →
  our fields, per import kind). Preset picker in the wizard's mapping step;
  files that match a preset's fingerprint (headers ⊇ signature) auto-select.
  Mappings are best-effort from public export formats — refined the first
  time a real switcher's file lands (issue says start with whichever comes
  first).
- `docs/migration-runbook.md`: how to get the export out of each of the
  three incumbents, what maps where, known quirks (encodings, date formats,
  Excel re-saves).

### PR 4 — AI column mapping (M)

- Wizard's mapping step gains "Suggest mapping": send **headers + 5 sample
  rows only** (never the whole file) to Haiku; response = per-target-field
  `{sourceHeader, confidence: high|medium|low}`; UI pre-fills the dropdowns
  with confidence chips, low-confidence left unmapped for the human. Human
  always confirms — AI never commits an import.
- Standard AI plumbing: `aiBriefSystemBlock` injected, `recordAiUsage`
  metered, plain fallback (auto-match by normalised header name — PR 2's
  behaviour) when the call fails. Kind-aware: the prompt lists the target
  fields for the selected import kind.

## Explicit MVP cuts

- No per-batch undo UI (batch ids make it possible later; wipe-by-batch is a
  psql one-liner meanwhile).
- No XLSX parsing — CSV only (the runbook tells each incumbent's export to
  save as CSV).
- No line-item detail on imported invoices (header totals only).
- No direct API pulls from incumbents (they don't offer them).

## Risks / repo gotchas

- Migration version: check latest on disk first (currently `20260712130000`).
- New tables ship with RLS: `is_org_staff(organization_id)` select for both;
  writes stay admin-client only (same posture as the payments ledger).
- `set_org_from_location` backfills org where applicable — history entries
  carry organization_id explicitly (they hang off vehicles, not locations).
- Imported invoices must never enter `nextDocumentNumber`, dunning, Xero,
  aged debtors, or revenue — separate table makes every exclusion structural
  rather than a filter someone can forget.
- Reminder-date import updates `vehicles` in place: only fill blanks by
  default; "overwrite existing dates" is an explicit checkbox.
- CSV parser: keep the existing quote-aware line parser; add BOM strip +
  delimiter sniff (TechMan exports semicolon-delimited files in some locales).

## Acceptance (from #505, restated)

1. TechMan-shaped export round-trips: import → customer/vehicle pages show
   history → MOT reminders fire off imported dates. (PRs 2–3)
2. Dry-run reports rejects with reasons; nothing partial committed on
   failure. (PR 2)
3. Runbook covers TechMan, Garage Hive, Autowork Online. (PR 3)

## Sizing

| PR | Scope | Size |
|---|---|---|
| 1 | This spec | — |
| 2 | Engine v2: mapping, dry-run, history + reminders, wizard | L |
| 3 | Imported invoices + presets + runbook | M |
| 4 | AI column mapping | M |
