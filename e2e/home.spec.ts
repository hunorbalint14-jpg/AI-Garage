import { test, expect } from "@playwright/test";

// Root landing page must render for an anonymous visitor. On the apex domain
// (no tenant subdomain) this is the marketing page; on a tenant subdomain it's
// the branded customer portal. Either way it returns 200 and shows a sign-in
// entry point — a DB-independent smoke check.
test("home page renders for an anonymous visitor", async ({ page }) => {
  const res = await page.goto("/");
  expect(res?.status()).toBeLessThan(400);
  await expect(page.getByText(/sign in/i).first()).toBeVisible();
});
