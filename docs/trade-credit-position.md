# Trade accounts & consumer-credit law — the position (#504)

Decided 2026-07-11, alongside the trade-accounts build
(`docs/account-customers-build-spec.md`). **Not legal advice** — this records
the reasoning the product is built on and the lines not to cross. Put the
wording in front of the garage's accountant/solicitor as part of the parked
accountant sign-off (see #451's leftovers) before pilot chains lean on it.

## Why trade accounts are fine

1. **The garage is the credit grantor, not the platform.** AI Garage provides
   tooling (terms, statements, dunning); the garage extends the credit. We are
   not lending and not credit-broking — the same posture as service plans,
   where the rule was "prepayment, not credit".

2. **Credit to limited companies is outside the Consumer Credit Act
   entirely.** Bodies corporate aren't "individuals" under the CCA. 30-day
   invoicing to a company is ordinary commerce — every parts factor and
   builder's merchant runs trade accounts without FCA authorisation.

3. **Credit to sole traders / small partnerships / individuals** (who *are*
   CCA "individuals") relies on the **normal trade-credit exemption** (the
   RAO article 60F family): broadly, the balance must be repayable within a
   defined short window (per statement period / within 12 months, limited
   instalments) and **no interest or charges may be made on the credit**.
   "Invoice due in 30 days, monthly statement, no interest" fits.

## The load-bearing product constraints

These keep the exemption; changing them changes the regulatory character:

- **No interest on overdue balances.** Deliberately an MVP cut in the #504
  spec — it is NOT just a deferred feature. Charging interest or credit fees
  to non-corporate customers can pull the agreements into FCA-regulated
  territory. Do not build it without real legal advice first.
- **No charges for the credit itself.** Payment terms and credit limits are
  fine; "account fees" are not, for the same reason.
- **Defined, short terms.** `payment_terms_days` is capped in the UI (≤120);
  keep terms bounded and statements regular.
- Late-payment interest on **B2B** debts (Late Payment of Commercial Debts
  Act) is a separate, garage-level choice outside the app today. If ever
  surfaced in-product, gate it to corporate customers only.

## What this means for features

| Feature | Status |
|---|---|
| Terms, credit limits, statements, dunning letters | Fine — built (#504) |
| Stripe card payment of an account invoice / balance | Fine — it's payment collection, not credit |
| BACS Direct Debit collection of statements | Fine as collection; mandate wording should go through the same sign-off |
| Interest on overdue balances | **Blocked pending legal advice** |
| Account/credit fees | **Blocked pending legal advice** |
| Financing/factoring of invoices | Different product entirely — full advice needed |
