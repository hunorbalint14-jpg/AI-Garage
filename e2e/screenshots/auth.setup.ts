import { test as setup } from "@playwright/test";
import fs from "node:fs";
import { TENANT_ORIGIN, AUTH_DIR, STAFF_STATE, CUSTOMER_STATE, CREDS } from "./helpers";

// Establish real signed-in sessions by driving the actual password login forms
// (both portals support signInWithPassword), then persist storage state for the
// capture project. No app internals, no email round-trip — relies only on the
// demo users created by `npm run help:seed`.

setup.beforeAll(() => {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
});

setup("authenticate staff", async ({ page }) => {
  await page.goto(`${TENANT_ORIGIN}/staff/login`);
  await page.fill("#email", CREDS.staffEmail);
  await page.fill("#password", CREDS.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  // Multi-branch staff land on the branch chooser first (post-#370); pick the
  // first branch to reach the portal. Single-branch goes straight to /staff.
  await page.waitForURL(/\/staff(\/select-branch)?$/, { timeout: 30_000 });
  if (page.url().includes("/staff/select-branch")) {
    await page.locator("button", { hasText: /.+/ }).first().click();
    await page.waitForURL(/\/staff$/, { timeout: 30_000 });
  }
  await page.context().storageState({ path: STAFF_STATE });
});

setup("authenticate customer", async ({ page }) => {
  await page.goto(`${TENANT_ORIGIN}/login`);
  // The customer form defaults to magic-link; switch to the password tab.
  await page.getByRole("button", { name: "Password" }).click();
  await page.fill("#email", CREDS.customerEmail);
  await page.fill("#password", CREDS.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard", { timeout: 30_000 });
  await page.context().storageState({ path: CUSTOMER_STATE });
});
