import { test, expect } from "@playwright/test";

// An unknown route returns Next's 404 — not a 500. Confirms middleware +
// rendering don't blow up on an unmatched path.
test("unknown route returns 404", async ({ page }) => {
  const res = await page.goto("/this-route-does-not-exist-7f3a9c");
  expect(res?.status()).toBe(404);
});
