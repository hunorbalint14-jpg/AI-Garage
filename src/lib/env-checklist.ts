// Production environment checklist — the single source of truth for the env
// vars this app needs, plus a pure checker. Driven by `npm run check:env`
// (scripts/check-env.ts) and documented in docs/production-env-checklist.md.
//
// CORE = the app is broken without it. FEATURE = that feature silently
// degrades (the exact failure mode is listed). Keep this in step with the code.
//
// Note ANTHROPIC_API_KEY is read implicitly by `new Anthropic()` (so it never
// appears as process.env.ANTHROPIC_API_KEY in the source) — it's listed here
// deliberately.

export type EnvLevel = "core" | "feature";
export type EnvVar = { name: string; level: EnvLevel; group: string; ifMissing: string };
/** At least one of `options` (each an all-required set) must be fully present. */
export type EnvOneOf = { group: string; level: EnvLevel; ifMissing: string; options: string[][] };

export const ENV_VARS: EnvVar[] = [
  // ── Core ────────────────────────────────────────────────────────────────
  { name: "NEXT_PUBLIC_SUPABASE_URL", level: "core", group: "Supabase", ifMissing: "No database/auth connection — the whole app fails." },
  { name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", level: "core", group: "Supabase", ifMissing: "Browser client + customer login broken." },
  { name: "SUPABASE_SERVICE_ROLE_KEY", level: "core", group: "Supabase", ifMissing: "Every server write, webhook and cron fails (service-role client)." },
  { name: "NEXT_PUBLIC_ROOT_DOMAIN", level: "core", group: "Tenancy", ifMissing: "Subdomain→organisation resolution breaks — tenants unreachable." },
  { name: "APP_ENCRYPTION_KEY", level: "core", group: "Crypto", ifMissing: "Throws on any encrypted-field op (Xero connect). Must be 32 bytes base64." },
  { name: "RESET_TOKEN_SECRET", level: "core", group: "Auth", ifMissing: "Password-reset tokens can't be signed/verified." },
  { name: "CRON_SECRET", level: "core", group: "Cron", ifMissing: "Cron endpoints are ungated — anyone can trigger reminders/dunning/etc." },

  // ── Payments (Stripe) ─────────────────────────────────────────────────────
  { name: "STRIPE_SECRET_KEY", level: "feature", group: "Payments (Stripe)", ifMissing: "Checkout, deposits and refunds all fail." },
  { name: "STRIPE_WEBHOOK_SECRET", level: "feature", group: "Payments (Stripe)", ifMissing: "Webhook handler returns 500 → payments are never confirmed (invoices stay unpaid)." },
  { name: "STRIPE_TENANT_PRICE_PRO_MONTHLY", level: "feature", group: "Payments (Stripe)", ifMissing: "Tenant Pro monthly checkout can't price (must be the Stripe Price for £49/mo)." },
  { name: "STRIPE_TENANT_PRICE_PRO_ANNUAL", level: "feature", group: "Payments (Stripe)", ifMissing: "Tenant Pro annual checkout can't price (must be the Stripe Price for £490/yr)." },
  { name: "STRIPE_TENANT_PRICE_GROWTH_MONTHLY", level: "feature", group: "Payments (Stripe)", ifMissing: "Tenant Growth monthly checkout can't price (must be the Stripe Price for £149/mo)." },
  { name: "STRIPE_TENANT_PRICE_GROWTH_ANNUAL", level: "feature", group: "Payments (Stripe)", ifMissing: "Tenant Growth annual checkout can't price (must be the Stripe Price for £1,490/yr)." },

  // ── AI (Anthropic) — read implicitly by the SDK ───────────────────────────
  { name: "ANTHROPIC_API_KEY", level: "feature", group: "AI (Anthropic)", ifMissing: "Support assist, message drafting, diagnostics and the receptionist all fail." },

  // ── Email (Resend) ────────────────────────────────────────────────────────
  { name: "RESEND_API_KEY", level: "feature", group: "Email (Resend)", ifMissing: "All transactional email (confirmations, quotes, invoices, reminders) silently fails." },
  { name: "RESEND_FROM_EMAIL", level: "feature", group: "Email (Resend)", ifMissing: "No verified sender address — deliverability/branding suffer." },
  { name: "RESEND_SENDER_NAME", level: "feature", group: "Email (Resend)", ifMissing: "Sender display name falls back to a default." },
  { name: "RESEND_WEBHOOK_SECRET", level: "feature", group: "Email (Resend)", ifMissing: "Bounce/complaint handling can't verify webhooks — bad addresses keep getting mailed." },

  // ── Vehicle data (DVLA / DVSA) ────────────────────────────────────────────
  { name: "DVLA_VES_API_KEY", level: "feature", group: "Vehicle data (DVLA/DVSA)", ifMissing: "Registration lookup (make/model/tax) fails." },
  { name: "DVSA_CLIENT_ID", level: "feature", group: "Vehicle data (DVLA/DVSA)", ifMissing: "MOT history + due dates can't be fetched." },
  { name: "DVSA_CLIENT_SECRET", level: "feature", group: "Vehicle data (DVLA/DVSA)", ifMissing: "MOT history + due dates can't be fetched." },
  { name: "DVSA_MOT_API_KEY", level: "feature", group: "Vehicle data (DVLA/DVSA)", ifMissing: "MOT history API rejects requests." },
  { name: "DVSA_TOKEN_URL", level: "feature", group: "Vehicle data (DVLA/DVSA)", ifMissing: "DVSA OAuth token can't be obtained." },
  { name: "DVSA_SCOPE", level: "feature", group: "Vehicle data (DVLA/DVSA)", ifMissing: "DVSA OAuth scope missing." },

  // ── SMS / WhatsApp (Twilio) ───────────────────────────────────────────────
  { name: "TWILIO_ACCOUNT_SID", level: "feature", group: "SMS/WhatsApp (Twilio)", ifMissing: "SMS/WhatsApp reminders + the AI receptionist's texts don't send." },
  { name: "TWILIO_AUTH_TOKEN", level: "feature", group: "SMS/WhatsApp (Twilio)", ifMissing: "Twilio auth fails — no SMS/WhatsApp." },
  { name: "TWILIO_FROM_NUMBER", level: "feature", group: "SMS/WhatsApp (Twilio)", ifMissing: "No SMS sender number." },
  { name: "TWILIO_WHATSAPP_FROM", level: "feature", group: "SMS/WhatsApp (Twilio)", ifMissing: "No WhatsApp sender." },

  // ── Xero (accounting) ─────────────────────────────────────────────────────
  { name: "XERO_CLIENT_ID", level: "feature", group: "Xero", ifMissing: "Xero OAuth connect fails — no accounting sync." },
  { name: "XERO_CLIENT_SECRET", level: "feature", group: "Xero", ifMissing: "Xero OAuth connect fails." },
  { name: "XERO_SALES_ACCOUNT_CODE", level: "feature", group: "Xero", ifMissing: "Synced invoices land in the wrong/no account code." },

  // ── Passkeys (WebAuthn) ───────────────────────────────────────────────────
  { name: "WEBAUTHN_RP_ID", level: "feature", group: "Passkeys", ifMissing: "Passkey registration/login fails (relying-party id)." },
  { name: "WEBAUTHN_RP_NAME", level: "feature", group: "Passkeys", ifMissing: "Passkey prompt shows a blank/default app name." },

  // ── Support + platform admin ──────────────────────────────────────────────
  { name: "PLATFORM_SUPPORT_EMAIL", level: "feature", group: "Support", ifMissing: "New support tickets skip the devops email notification (log warning only)." },
  { name: "PLATFORM_ADMIN_EMAILS", level: "feature", group: "Support", ifMissing: "Platform-admin bootstrap/gating for the admin portal may be unset." },

  // ── Observability (Sentry) ────────────────────────────────────────────────
  { name: "NEXT_PUBLIC_SENTRY_DSN", level: "feature", group: "Observability (Sentry)", ifMissing: "Browser errors aren't captured." },
  { name: "SENTRY_DSN", level: "feature", group: "Observability (Sentry)", ifMissing: "Server errors aren't captured." },

  // ── Ops alerting ──────────────────────────────────────────────────────────
  { name: "SLACK_OPS_WEBHOOK_URL", level: "feature", group: "Ops alerting", ifMissing: "Ops alerts have nowhere to go (see issue #449)." },
];

export const ENV_ONE_OF: EnvOneOf[] = [
  {
    group: "Rate limiting (Upstash)",
    level: "feature",
    ifMissing: "Auth endpoints are NOT throttled — brute-force/enumeration is unbounded.",
    options: [
      ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"],
      ["UPSTASH_KV_REST_API_URL", "UPSTASH_KV_REST_API_TOKEN"],
    ],
  },
];

// Platform-set automatically (Vercel/Next/CI) — do not set by hand.
export const AUTO_VARS = ["VERCEL_ENV", "NEXT_PUBLIC_VERCEL_ENV", "VERCEL_GIT_COMMIT_SHA", "NEXT_RUNTIME", "NODE_ENV", "CI"];
// Dev/test/demo only — must NOT be set in production.
export const DEV_ONLY_VARS = ["DEMO_MOT_FIXTURES", "HELP_DEMO_PASSWORD", "HELP_TENANT_SLUG", "PREVIEW_TENANT_SLUG", "TEST_VERBOSE", "ROOT_DOMAIN"];

export type EnvReport = { coreMissing: string[]; featureMissing: EnvVar[]; oneOfMissing: EnvOneOf[]; devOnlySet: string[] };

export function checkEnv(env: Record<string, string | undefined>): EnvReport {
  const has = (n: string) => typeof env[n] === "string" && env[n]!.trim() !== "";
  return {
    coreMissing: ENV_VARS.filter((v) => v.level === "core" && !has(v.name)).map((v) => v.name),
    featureMissing: ENV_VARS.filter((v) => v.level === "feature" && !has(v.name)),
    oneOfMissing: ENV_ONE_OF.filter((g) => !g.options.some((set) => set.every(has))),
    devOnlySet: DEV_ONLY_VARS.filter(has),
  };
}
