import { defineConfig, devices } from "@playwright/test";
import { ROOT_ORIGIN } from "./e2e/screenshots/helpers";

// SEPARATE from playwright.config.ts (the smoke suite that runs in CI). This one
// drives a seeded local tenant to capture screenshots for the user manual, so it
// needs a populated Supabase + the demo seed (`npm run help:seed`) first. It is
// NOT referenced by `npm run test:e2e` and never runs in CI.
//
//   npm run help:capture
//
// `setup` logs in (staff + customer) and saves storage state; `capture` then
// shoots every section from the manifest at a crisp 2x desktop viewport.
export default defineConfig({
  testDir: "e2e/screenshots",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    trace: "off",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "capture",
      testMatch: /capture\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: ROOT_ORIGIN,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
