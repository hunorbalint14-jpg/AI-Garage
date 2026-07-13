# Parts catalogue & supplier ordering — build spec (#499)

Every established UK competitor has reg → parts lookup + electronic supplier
ordering — it's often *why* a garage picks them (MAM Autocat, TechMan's ECP/GSF
links, Garage Hive + GSF/Dingbro). We already have the *internal* half:
`products` (with `cost_price` + `unit_price`), `suppliers`, a working
`purchase_orders` module, and `job_items` that carry `product_id` + `unit_cost`.
What's missing is the catalogue lookup, live supplier price/availability, and
electronic ordering — parts are keyed by hand.

This plan sequences the work so the **AI + margin value ships first with zero
external dependency**, and the supplier-API integration slots in behind a clean
interface once a trade account exists.

## The load-bearing decisions

### Supplier connectivity — the route (PR 3 spike resolves; leaning noted)
Three realistic routes for an independent platform, in rising order of cost:

1. **Punch-out / order-by-email** — deep-link into the supplier's own basket
   (or send a structured order email through the existing email infra), then
   import the confirmation. *No API contract, works with any factor, degraded
   by design.* Weakest data (no live availability), but shippable against any
   supplier tomorrow. **Leaning: launch here.**
2. **Trade API** (GSF / Euro Car Parts / Alliance) — real price + availability
   + electronic order. Best UX; needs a per-supplier trade account, API
   credentials, and each vendor's bespoke contract. One launch supplier only.
3. **TecDoc catalogue data** — the OE cross-reference / fitment database behind
   most factors. Licensed data (paid), heavy; gives reg→parts *catalogue* even
   without a specific supplier's stock. Consider once >1 supplier matters.

**Decision recorded here so it isn't re-litigated:** build the whole flow
against a **`SupplierConnector` interface** (quote(reg, query) → priced lines;
placeOrder(lines) → order ref; fetchConfirmation()). Ship a `ManualConnector`
(punch-out/email) as launch, add a `GsfConnector` (or whichever the first real
switcher uses) behind the same interface when the account lands. The job-screen
and PO UX never know which connector is live.

### Parts are products, priced by markup
A catalogue line becomes a `products` row (or matches an existing one by SKU),
so stock, POs and job lines all keep working unchanged. Cost→sell uses a new
**org markup rule** (see below); the AI + guardrail operate on that.

### Markup rules (new — small)
`organizations.parts_markup_rules jsonb` + `parts_target_margin_pct int`:
a banded markup (e.g. cost <£10 → ×2.2, <£50 → ×1.8, else ×1.5) with a target
margin the guardrail warns under. Falls back to a single default multiplier.
This is the only schema addition PR 2 needs — everything else it reads exists.

## Shape

### PR 1 — this spec

### PR 2 — AI parts suggestion + margin guardrail (M) — **no external dependency**
The differentiator, buildable today against internal data only.
- `organizations.parts_markup_rules` + `parts_target_margin_pct` migration;
  a Settings → Business "Parts pricing" card (bands + target).
- `src/lib/ai-parts.ts` (mirrors `ai-labour.ts`: Haiku, `aiBriefSystemBlock`,
  `recordAiUsage` feature `parts_suggest`, plain fallback): from the job
  description + vehicle (reg already resolves via `dvla-ves`), propose a parts
  list — name, category, quantity, **fitment caveats** ("confirm 288mm disc —
  two variants on this chassis"). Pure parse + a unit test on the shaping.
- Job screen: "Suggest parts (AI)" → each suggestion matched against the
  branch's `products` by name/category for a cost; markup rule computes sell;
  **per-line margin badge, amber when under target**. One tap adds chosen lines
  to the job (`job_items`, `type='part'`, `unit_cost` from the product).
- Suggestions with no catalogue match are addable as free-type lines (cost
  blank → flagged, same "missing cost" treatment as #502).
- Acceptance: "front pads + discs, Golf mk7 1.6 TDI" → priced suggestions with
  a sub-target line flagged; adding lands them on the job with cost captured.

### PR 3 — supplier connectivity spike + `SupplierConnector` + ManualConnector (L)
- `supplier_integrations` table (supplier_id, connector kind, encrypted
  credentials via `lib/encryption.ts`, enabled) — credentials write-only,
  same posture as the Xero/finance configs.
- `SupplierConnector` interface + `ManualConnector` (punch-out URL builder +
  structured order email through `lib/email.ts`; confirmation imported from a
  paste/upload, or a parsed reply). Spike documents the one trade API we'll
  target next and what its account needs (folded into the env checklist).
- No job-screen change yet — this is the plumbing + one working manual path.

### PR 4 — reg → catalogue lookup on the job screen (M) — needs a live connector
- "Find parts" on the job: `connector.quote(reg, query)` → priced availability
  list (category tree / OE cross-refs where the connector provides them);
  chosen lines become `products` (matched by SKU) + job lines with cost.
- Degrades to PR 2's manual/AI entry when the connector is down (acceptance).

### PR 5 — electronic PO + receive against it (M) — needs a live connector
- From the existing purchase-orders module: `connector.placeOrder(lines)` →
  supplier order ref stored on the PO; receive against it flips stock and
  stamps `received_at`; **cost captured per line back onto the originating job**
  so margin is real, not estimated.
- Suggested orders from `reorder_at` stock levels (the issue's "suggested
  orders") — a thin pass over `products` where `stock_qty <= reorder_at`.

## Explicit MVP cuts
- Only ONE supplier integrated for the API route; others stay manual.
- No TecDoc licence at launch (route 3) — revisit with a second supplier.
- No returns/credits flow against a supplier (receive-only first).
- No real-time stock sync — availability is fetched at lookup time, not cached
  live.

## Risks / repo gotchas
- Migration version: check disk first (currently `20260712180000`).
- Supplier credentials AES-encrypted before write (`APP_ENCRYPTION_KEY`,
  `lib/encryption.ts`); the settings action returns only *whether* they're set,
  never the values (mirror `finance-actions`).
- New tables ship RLS: `is_location_member` / `is_org_finance` select, writes
  admin-client only. `supplier_integrations` is finance-sensitive.
- AI parts suggestion must inject the org AI brief (`aiBriefSystemBlock`) and
  meter usage (`recordAiUsage`), like every AI feature; plain fallback never
  blocks the job.
- Parts→products dedupe by `(location_id, sku)` — a null/blank SKU must NOT
  collapse distinct catalogue lines into one product.
- Job-line cost must be the **product cost at time of fitting**, snapshotted
  onto `job_items.unit_cost` (products' cost can change later) — same immutable
  posture as the VAT snapshot.

## Acceptance (from #499, restated)
1. One supplier end-to-end: reg lookup → priced availability → PO sent → goods
   received → cost on the job line. (PRs 3–5, one live connector)
2. Markup rules applied automatically; sub-target margin flagged. (PR 2)
3. Works degraded (manual entry) when the supplier is down. (PR 2 is the
   degraded path PRs 4–5 fall back to.)

## Sizing
| PR | Scope | Size | Blocked on |
|---|---|---|---|
| 1 | This spec | — | — |
| 2 | AI parts suggest + margin guardrail | M | nothing — ships now |
| 3 | Connector interface + ManualConnector + spike | L | — (manual path) |
| 4 | Reg → catalogue lookup on the job | M | a live trade-API account |
| 5 | Electronic PO + receive + suggested orders | M | a live trade-API account |
