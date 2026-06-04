import { test, expect } from "@playwright/test";

// Staff login is a public GET (it must be reachable without a session) and the
// form is tenant-independent, so it's a stable smoke target.
test("staff login page renders the sign-in form", async ({ page }) => {
  await page.goto("/staff/login");
  await expect(
    page.getByRole("heading", { name: "Staff sign in" }),
  ).toBeVisible();
  await expect(page.locator("#email")).toBeVisible();
  await expect(page.locator("#password")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /sign in with passkey/i }),
  ).toBeVisible();
});
