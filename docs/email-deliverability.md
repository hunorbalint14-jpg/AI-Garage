# Email deliverability

Every customer-facing touch (booking confirmations, quotes, invoices, reminders,
review requests) is email via Resend. If the sending domain isn't authenticated,
it lands in spam and the garage looks broken. This is the go-live checklist for
email — covers issue #444.

## 1. Authenticate the sending domain (SPF / DKIM / DMARC)

Done once, in Resend + your DNS. `RESEND_FROM_EMAIL` must be on this domain.

1. **Resend → Domains → Add** the sending domain (e.g. `ai-garage.co.uk`).
2. Add the DNS records Resend generates:
   - **SPF** — a `TXT` on the send subdomain, e.g. `v=spf1 include:amazonses.com ~all`.
   - **DKIM** — the three `CNAME` records Resend lists (`resend._domainkey…`).
   - **DMARC** — a `TXT` at `_dmarc.<domain>`, start at `v=DMARC1; p=none; rua=mailto:dmarc@<domain>` (monitor), tighten to `p=quarantine` then `p=reject` once the `rua` reports are clean.
3. Wait for Resend to show the domain **Verified** (green).

### Verify it actually passes
- [ ] Resend dashboard shows the domain **Verified** (SPF + DKIM green).
- [ ] `dig +short TXT <domain>` shows the SPF record; `dig +short TXT _dmarc.<domain>` shows DMARC; `dig +short CNAME resend._domainkey.<domain>` resolves.
- [ ] Send a real email to **https://www.mail-tester.com** (or check Gmail → *Show original*): **SPF pass, DKIM pass, DMARC pass**, score ≥ 9/10.

## 2. From-address strategy

**Decision: one shared, authenticated platform domain for all tenants; branding is carried in the display name and body, not the domain.**

- Sender is a single env: `RESEND_SENDER_NAME <RESEND_FROM_EMAIL>` (see `src/lib/email.ts`) — e.g. `AI Garage <no-reply@ai-garage.co.uk>`.
- Per-tenant identity is carried by the **display name / brand + branch block inside the email** (`src/lib/garage-identity.ts`), not by a per-tenant from-domain.
- **Why not per-tenant subdomains/domains:** each would need its own SPF/DKIM/DMARC set up and warmed — an ops burden per garage and a deliverability risk on cold domains. One warm, authenticated shared domain is the most reliable at launch.
- **Consequence:** the shared domain's reputation is shared across all tenants — so a hard bounce or spam complaint from *any* tenant must stop us mailing that address everywhere (see §3, the suppression list is global by design).
- Replies: `RESEND_FROM_EMAIL` should be a monitored or auto-responding inbox (or set a `reply-to` later); avoid a black-hole `no-reply` if customers might reply to a booking confirmation.

## 3. Bounce & complaint handling (the suppression list)

Wired in code — the Resend webhook writes a suppression list and the send path
checks it, so we stop mailing dead inboxes and people who marked us as spam.

- **Webhook** `/api/webhooks/resend` (`src/app/api/webhooks/resend/route.ts`) verifies the Svix signature (`RESEND_WEBHOOK_SECRET`), then on:
  - **`email.bounced`** with a **permanent** bounce → adds the recipient to `email_suppressions` (reason `hard_bounce`). A **transient** (soft) bounce does *not* suppress — it may clear.
  - **`email.complained`** → adds the recipient (reason `complaint`).
  - It also mirrors delivery state onto `reminders` (opened/clicked/delivered/bounced).
- **Send path** `src/lib/email.ts` (`sendEmail` + `sendEmailBatch`, the only Resend senders) consults `email_suppressions` before every send and **skips** suppressed recipients (result flagged `suppressed: true`).
- **Store** `email_suppressions` (migration `20260706130000`) — keyed on the lowercased address, **global** (not tenant-scoped, per §2). Platform-admin read-only via RLS; the webhook + send path write via the service-role client.
- The decision logic (`parseSuppression`, `isHardBounce`) is pure and unit-tested (`src/lib/email-suppression.test.ts`).

### Verify (production)
1. In Resend → **Webhooks**, point an endpoint at `https://<root>/api/webhooks/resend` subscribed to `email.bounced`, `email.complained`, `email.delivered`, `email.opened`, `email.clicked`; set `RESEND_WEBHOOK_SECRET` to its signing secret.
2. Trigger a hard bounce (Resend's test address `bounced@resend.dev`) and a complaint (`complained@resend.dev`).
3. [ ] A row appears in `email_suppressions` for each; a subsequent send to that address is skipped (`suppressed: true`, no Resend call).

> Verified locally end-to-end: a signed permanent-bounce and a complaint event each land in `email_suppressions`; a signed transient bounce does not.
