# AI Garage — Subscription & Service Plan Policy Build Specification

**Purpose:** This is a build brief for generating the contractual and policy documents AI Garage needs for (a) its SaaS subscription and (b) the service plans its garages run on the platform. It captures the structural, regulatory, and drafting decisions already made so an AI agent can draft the documents against a consistent set of constraints.

**Status:** Working specification, **not legal advice**. Every document produced from this spec must be reviewed by a UK-qualified solicitor (commercial + consumer-credit) before use. Regulatory timings noted below are current **as at June 2026** and should be re-checked, especially the DMCC subscription regime.

**Jurisdiction:** All of the UK (England & Wales, Scotland, Northern Ireland).

---

## 0. Instructions for the drafting agent

- Write in UK English, plain but precise legal register.
- Use clear placeholders for variable terms: `[AI GARAGE LEGAL ENTITY]`, `[GARAGE NAME]`, `[PLAN NAME]`, `[MONTHLY PRICE]`, `[SERVICES COVERED]`, `[NOTICE PERIOD]`, etc.
- Where a clause depends on a legal judgement that needs a solicitor, insert an inline flag: `>> SOLICITOR REVIEW: ...`.
- Produce each document as a separate file.
- Do **not** assert that any document is "compliant" or "legally approved" — these are drafts for review.

---

## 1. Business model — the two contractual relationships

There are two distinct contracts under two different bodies of law. Keep them separate at all times.

**Relationship A — AI Garage → Garage (B2B SaaS subscription).**
The garage subscribes to AI Garage at £150–350/month. Both parties are businesses, so consumer-protection law (Consumer Contracts Regulations 2013, the DMCC subscription regime, the consumer provisions of the Consumer Rights Act 2015) does **not** apply. Broad freedom of contract.

**Relationship B — Garage → Motorist (service plan subscription).**
The motorist (a consumer) pays ~£30–40/month toward scheduled servicing. Full consumer-protection law applies. Critically:

- The **garage is the counterparty and the merchant of record**, not AI Garage.
- **AI Garage is the technology provider only.** It is not a party to the service plan, does not sell the plan, and does not hold the motorist's money.

This positioning is the foundation of AI Garage's liability insulation. Every document must reinforce it.

---

## 2. Payment architecture

**SaaS (Relationship A):** Stripe Billing. The garage pays AI Garage. Offer **monthly rolling** and **annual** options (annual at a discount). Because the garage is a business, the annual term may auto-renew with notice.

**Service plans (Relationship B):** Stripe Connect using **direct charges**. Funds flow to **each garage's own Stripe account**; the garage is the merchant of record and bears chargeback/dispute liability. **AI Garage never holds or routes motorist funds.** This keeps AI Garage out of payment-services regulation and client-money/safeguarding obligations.

**Payment method:** **card-on-file only** (no Direct Debit, so no Direct Debit Guarantee wording required). Requirements to build:

- Explicit consent at setup to store the card and charge it on a **recurring, off-session** basis (Stripe recurring-payment mandate text).
- Strong Customer Authentication (SCA) on the initial setup; subsequent charges as merchant-initiated transactions.
- Stripe card-updater enabled (24-month plans outlive many cards).
- Robust retry/dunning logic and a clear missed-payment process (see §6).

---

## 3. Regulatory positioning — critical constraints

### 3.1 The service plan MUST be structured as prepayment, not credit

**Principle:** Credit = the customer receives the service before paying for it and pays the balance over time. Prepayment = the customer pays before receiving the service. Only credit is regulated. A monthly subscription can be either — the label does not decide it; the timing of service delivery vs payment does.

**Binding design rule:** *No service or MOT is carried out under the plan until the customer's accrued payments cover it* ("no draw-down before funded"). This is the backstop that keeps the product non-credit in all cases, including edge cases.

**Onboarding rule (front door):** A customer may only be enrolled either:
1. immediately **after a service + MOT** (next scheduled service is ~12 months away), or
2. on terms that the **first plan service falls at least 12 months after signup**.

Both ensure the customer pre-pays toward a service they have not yet drawn.

**Pricing rule:** Cumulative payments must stay **ahead of** cumulative service value at **every** draw-down point. Example: £35/month = £420 over 12 months, comfortably ahead of a £255 service + MOT. If a plan ever covers heavier work (major service, cambelt) exceeding ~12 months of payments, a customer reaching it at month 12 would be in deficit — that slice is credit. Price each plan accordingly.

**MOT special handling:** An MOT's due date is fixed by law (first at 3 years from registration, then every 12 months) and **cannot** be deferred to "12 months after signup." The plan must not deliver an MOT before it has been funded. Either cover only the MOT falling **after** the pre-payment threshold, or confirm the arithmetic holds (e.g. at £35/month, an MOT drawn at month 2 is covered by £70 against a ~£55 MOT; a month-1 MOT tips slightly negative — avoid).

**Why this matters:** If the plan became a credit agreement and ran beyond the exemption (interest-free, no more than 12 instalments within no more than 12 months, no fees/charges), the **garage** would need FCA authorisation. Providing regulated credit without authorisation is a **criminal offence** and renders the agreement **unenforceable**. Even though the garage is the counterparty, AI Garage must not build a product that puts unauthorised garages in breach. `>> SOLICITOR REVIEW: obtain a written consumer-credit opinion confirming the prepayment structure and gating rule sit outside regulated credit.`

### 3.2 Avoid the plan looking like insurance

Cover **defined services at known prices** (e.g. "one full service + one MOT per 12 months"), **not** open-ended "we cover whatever your servicing costs." Open-ended cost-cover transfers risk for a premium and can be a regulated contract of insurance.

### 3.3 Keep AI Garage out of payment-services regulation

Reinforced by the direct-charges architecture in §2 — AI Garage never holds motorist funds.

---

## 4. Consumer-protection requirements (Relationship B)

Build all of these into the motorist-facing flow and documents.

**Consumer Contracts (Information, Cancellation and Additional Charges) Regulations 2013:**
- **14-day cooling-off period** running from the date the contract is made (distance contract).
- If the customer wants servicing performed **within** the cooling-off period, capture **express consent to begin early** plus an acknowledgement that they will pay for service used and lose the full cancellation right once the service is fully performed.
- **Refunds within 14 days** of being told of a cancellation.
- If the required cancellation information is not provided, the cancellation period **extends by up to 12 months** — so the cancellation notice and model cancellation form are mandatory.
- Payment button labelled as an order **with an obligation to pay** (e.g. "Subscribe and pay"). **No pre-ticked boxes.**
- Provide the **statutory cancellation information and a model cancellation form**.

**DMCC Act 2024 subscription regime (NOT yet in force — autumn 2026 at the earliest, pending secondary legislation):** build for it now to avoid a later rebuild:
- Cancellation must be **as easy to exit as to join** (frictionless online cancellation).
- Clear, prominent **pre-contract information**.
- **Reminder/renewal notices** at key points (roughly every 6 months for rolling monthly subscriptions).

**Consumer Rights Act 2015:** services must be performed with reasonable care and skill; these statutory rights **cannot be excluded**; unfair terms are not binding on the consumer.

---

## 5. Cancellation policy — Relationship A (SaaS, B2B)

- No statutory cooling-off (business customer); policy is AI Garage's choice.
- **Monthly rolling:** ~30 days' notice; access continues to the end of the paid period.
- **Annual:** either committed for the term or auto-renewing with a stated notice window; state the proration/refund stance plainly.
- Include a **data export / offboarding** clause.
- Include a **wind-down clause** for the motorist service plans the garage runs on the platform: cancellation of the garage's subscription must not orphan live motorist payment mandates. Specify orderly transfer/run-off/closure.

---

## 6. Cancellation policy — Relationship B (service plan, consumer)

- **Within 14-day cooling-off:** full refund, subject only to a deduction for any service already taken (with the customer's prior express consent), charged at the normal walk-in price.
- **After cooling-off:** rolling monthly cancellation; easy and online.
- **On cancellation, refund the unspent balance**, **less** any service already taken, charged at the **normal walk-in price** (not the discounted plan rate). This protects the garage against customers who join, draw a discounted service, and immediately cancel.
- **Missed payments (card-on-file):** retry and notify; suspend plan benefits while in arrears; **no draw-down while behind** — service waits until the customer is caught up or tops up the shortfall on the day.
- **Price changes:** permitted only with appropriate advance notice; specify the mechanism.

---

## 7. Document set to build

### For the garage (Relationship A — these protect AI Garage)
1. **Master Subscription Agreement (MSA)** — core B2B contract; carries the protective clauses in §8.
2. **Order Form** — tier, monthly/annual, price, term.
3. **Data Processing Agreement (DPA)** — **mandatory** under UK GDPR Article 28, because AI Garage processes the motorists' personal data on the garage's behalf.
4. **Acceptable Use Policy.**
5. **Privacy Policy** (AI Garage's own).
6. **Service Level Agreement** (optional; uptime/support).

### For garages to give their motorists (templates AI Garage provides)
7. **Service Plan Agreement / Plan Summary** — built around the §3.1 prepayment structure; states covered services, monthly amount, term, the funding/draw-down rule, cancellation/refund terms, and price-change mechanism. Presented clearly **before** payment.
8. **Service Plan Terms & Conditions** — see §9.
9. **Card-on-file recurring-payment consent** — §2 requirements; "Subscribe and pay" labelling; no pre-ticked boxes.
10. **Privacy notice** (motorist-facing).
11. **Statutory 14-day cancellation information + model cancellation form.**

---

## 8. Clauses that protect AI Garage (must appear in the B2B documents)

- **Liability cap** (e.g. limited to fees paid). Note: under the Unfair Contract Terms Act 1977, limitation clauses must be reasonable, and liability for death/personal injury caused by negligence, or for fraud, **cannot** be excluded. `>> SOLICITOR REVIEW: cap level and carve-outs.`
- **"Technology provider only"** statement: AI Garage is **not a party** to the garage–motorist service plan, **does not sell** it, and is **not the merchant of record**.
- **AI copilot disclaimer:** the service-advisor copilot provides **suggestions, not professional advice**; a human must remain in the loop; the garage is responsible for what it tells its customers and for the work performed.
- **Third-party data disclaimer:** DVLA and DVSA-derived data (numberplate lookup, MOT data, reminders) is **not warranted** for accuracy.
- **Garage indemnity:** the garage indemnifies AI Garage against claims arising from its service plans and its dealings with motorists.
- **Compliance responsibility:** the garage is solely responsible for its own legal, FCA, and consumer-law compliance toward its motorists.
- **Template terms provided "for convenience, not legal advice"**; the garage must take its own advice; **the garage owns any alterations** it makes and is solely responsible for them.
- **Do not market** the template as "compliant" and do not imply AI Garage handles the garage's legal/compliance burden (this creates reliance/misrepresentation exposure).
- **IP ownership** (AI Garage retains platform IP).
- **Data portability on exit.**

---

## 9. Template T&C content (protects the garage against its motorists)

- **Scope and exclusions** — what's covered; exclude wear-and-tear items (tyres, brake pads, wiper blades, etc.).
- **The funding/draw-down rule** from §3.1 (no service before funded).
- **Price-change clause** with notice.
- **Cancellation and refund terms** — cooling-off compliant and DMCC-ready (§4, §6).
- **Missed-payment process** (§6).
- **Transfer rules** (e.g. on sale of the vehicle; whether transferable and any condition).
- **Liability** appropriately limited **without** purporting to exclude the motorist's Consumer Rights Act 2015 service-quality rights.

---

## 10. Governing law / jurisdiction

- **B2B (Relationship A):** free choice — use English law and the courts of England & Wales.
- **Consumer (Relationship B):** a consumer cannot be deprived of the mandatory protections or the courts of their home UK nation. Keep the motorist terms neutral on jurisdiction. A **single UK-wide consumer template** works, since consumer law is broadly uniform across the three nations. `>> SOLICITOR REVIEW: governing-law/jurisdiction wording for consumer terms.`

---

## 11. Solicitor sign-off checklist (before launch)

1. **Consumer-credit opinion** on the prepayment structure and gating rule — confirm the plan sits outside regulated credit. *(Highest priority — this is the one genuine regulatory landmine.)*
2. Confirm the plan is **not** a contract of insurance.
3. **DPA and UK GDPR** review; controller/processor mapping.
4. **AI copilot liability** allocation between AI Garage and garage.
5. **Garage insolvency / consumer-prepayment** exposure — design/reputational consideration (motorists who have prepaid for services a failed garage won't deliver).
6. Confirm **Stripe Connect direct-charges** configuration places merchant-of-record status and dispute liability on the garage.
7. Confirm B2B **liability cap and indemnity** are reasonable under UCTA.

---

## 12. Out of scope for this spec (separate workstreams)

- **DVLA** numberplate/vehicle-data licensing and terms of access.
- **DVSA** MOT history API / MOT reminder service terms of use.
- **Marketing compliance** — note the DMCC's fake-review and drip-pricing rules are **already in force** (since April 2025) and apply to AI Garage's own marketing and any review-generation feature.
- **AML/KYC** — avoided under the direct-charges model (AI Garage holds no funds); revisit only if that architecture ever changes.
