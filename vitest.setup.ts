import { vi } from "vitest";

// Stable defaults so libs that read env at import-time don't blow up.
process.env.NEXT_PUBLIC_ROOT_DOMAIN ??= "ai-garage.test";
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-key";
process.env.CRON_SECRET ??= "test-cron-secret";
process.env.RESEND_API_KEY ??= "re_test";
process.env.RESEND_FROM_EMAIL ??= "test@example.com";
process.env.STRIPE_SECRET_KEY ??= "sk_test_dummy";
process.env.STRIPE_WEBHOOK_SECRET ??= "whsec_test";
process.env.TWILIO_ACCOUNT_SID ??= "ACtest";
process.env.TWILIO_AUTH_TOKEN ??= "token_test";
process.env.TWILIO_FROM_NUMBER ??= "+447000000000";
process.env.TWILIO_WHATSAPP_FROM ??= "whatsapp:+447000000000";
process.env.XERO_CLIENT_ID ??= "xero-client-id";
process.env.XERO_CLIENT_SECRET ??= "xero-secret";
process.env.XERO_TOKEN_ENCRYPTION_KEY ??= "0".repeat(64);
process.env.DVLA_API_KEY ??= "test-dvla";
process.env.DVSA_MOT_API_KEY ??= "test-dvsa";
process.env.DVLA_VES_API_KEY ??= "test-ves";

// Silence noisy console.error / console.warn in tests unless TEST_VERBOSE=1.
if (!process.env.TEST_VERBOSE) {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
}
