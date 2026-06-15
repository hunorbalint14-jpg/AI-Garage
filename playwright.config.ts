import { defineConfig, devices } from "@playwright/test";

const PORT = 3000;
const baseURL = `http://localhost:${PORT}`;

// Smoke-only E2E config. Targets public, no-auth, DB-independent pages so the
// suite runs green without a seeded Supabase project. Deeper authed flows
// (booking, pay, quote-approve) come later behind a test tenant + CI secrets.
//
// The dev server boots with placeholder NEXT_PUBLIC_SUPABASE_* env (set in CI
// and present locally via .env.local) — on localhost the host resolves to the
// root domain, so no tenant lookup hits the database.
export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.spec.ts",
  // The user-manual screenshot capture (e2e/screenshots) needs a seeded local
  // tenant + login — it runs via playwright.screenshots.config.ts, never here.
  testIgnore: "screenshots/**",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
