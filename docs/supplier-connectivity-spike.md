# Supplier connectivity spike (#568)

The deliverable of #499's PR 3: **which trade API do we integrate first, and
what does its account need?** Everything else in that PR is the plumbing that
makes the answer swappable — the `SupplierConnector` interface, the
`ManualConnector` we launch on, and the encrypted `supplier_integrations` row
that configures a supplier.

## Decision

**Launch on the manual connector; target one trade API only after a real garage
asks for it, and let that garage's existing factor pick the vendor for us.**

The manual connector (order email + punch-out deep link + pasted confirmation)
works with *every* UK factor on day one and costs nothing to onboard. A trade
API is per-vendor work gated on a commercial relationship. Building one
speculatively risks integrating a factor our first customers don't buy from —
the expensive kind of wrong.

So: the first pilot garage that wants live ordering names their factor, and we
build that connector. The interface means that is one file plus a registry
entry (see the checklist at the top of `src/lib/suppliers/types.ts`).

## Candidates, in the order we'd approach them

Ranked on how likely an independent garage already has a trade account and how
plausible programmatic ordering is. **None of these API details are confirmed —
each vendor's terms have to be established during the account application, and
that is exactly what the questions below are for.**

| Vendor | Why it's on the list | What to establish |
|---|---|---|
| **GSF Car Parts** | Widely used by independents; already integrated by competitor platforms (Garage Hive, TechMan), so a partner/integration route plausibly exists. | Is there a partner API programme? Per-branch or per-account credentials? |
| **Euro Car Parts (LKQ)** | The largest network; near-universal account coverage. | Whether third-party platform integration is offered at all, and on what commercial terms. |
| **Alliance Automotive / GROUPAUTO** | Federated factors — one integration could reach many local suppliers. | Whether ordering is central or per-member-factor. |
| **TecDoc (catalogue data, not a supplier)** | The OE cross-reference database behind most factors — gives reg → parts *catalogue* independent of any one supplier. | Licence cost for a SaaS platform; whether per-lookup or per-seat. Route 3 in the build spec: revisit when a second supplier matters. |

### Questions to put to whichever vendor comes first

1. Is there a documented ordering API (price + availability + place order), or
   only EDI / punch-out / email?
2. What credentials does it use — OAuth client, API key, or account + secret?
   Per garage account, or one platform-level credential acting on their behalf?
3. Is there a sandbox / test account? (Without one, the connector can only be
   proven against live orders — which we will not do on a customer's account.)
4. Are prices returned account-specific (their trade discount) or list?
5. Rate limits, and whether availability is per-branch.
6. Who owns the commercial relationship — us as a platform, or the garage?

Answers land in this doc, and the credential fields land in
`CONNECTOR_CREDENTIAL_FIELDS` (`src/lib/suppliers/types.ts`), which renders the
settings inputs automatically.

## What ships now (the manual path)

- **Ordering config per supplier** — Suppliers page → the "Ordering" badge on a
  supplier row. Order email, catalogue link, trade account number, on/off.
  Credentials are **write-only**: encrypted with `APP_ENCRYPTION_KEY` on save,
  never returned to the browser (the UI only learns `hasCredentials`).
- **Send** — purchase-order screen → "Send to supplier". With an order email
  set, the order is emailed (org **and branch** identity, trade account, our
  reference, line table) and the PO flips to `ordered`. Without one, the
  catalogue link is returned as a punch-out hand-off — **nothing is sent**, the
  PO stays a draft, and the human finishes in the supplier's basket.
- **Confirm** — "Import confirmation": paste the supplier's reply, we read
  their order reference and confirmed unit costs, and write those costs onto
  the matching PO lines. Matching runs SKU-first and is one-to-one; anything
  ambiguous is reported as unmatched rather than guessed at, and the raw text
  is stored so a bad parse can be re-read.

Deliberately absent: live availability, electronic acknowledgement, order
status polling. Those are what the trade API buys, and why PRs 4–5 exist.

## Environment (nothing new today — for #445 when the account lands)

The manual connector needs **no new environment variables**: it uses the
existing `RESEND_*` email path and `APP_ENCRYPTION_KEY` (already CORE) for the
credential blob.

When the first trade-API connector lands, add its credentials to
`src/lib/env-checklist.ts` under a **Supplier ordering** group — as `feature`
level, with the failure mode "live parts lookup and electronic ordering fall
back to the manual path" — and mirror the row into
[`production-env-checklist.md`](./production-env-checklist.md). If the vendor
issues per-garage credentials rather than a platform key, they belong in
`supplier_integrations.credentials` (encrypted, per supplier) and **not** in the
environment at all.

## Related

- Build spec: [`parts-catalogue-build-spec.md`](./parts-catalogue-build-spec.md) (PR 3)
- Epic: #499 · this PR: #568 · blocked next: #569 (reg → catalogue), #570 (electronic PO)
