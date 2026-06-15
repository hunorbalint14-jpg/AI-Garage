import { test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { allSections } from "../../docs/help/manual.content";
import {
  TENANT_ORIGIN,
  ROOT_ORIGIN,
  STAFF_STATE,
  CUSTOMER_STATE,
  IMAGES_DIR,
} from "./helpers";

// One test per manifest section. Uses the right persona's saved session (public
// sections get a fresh, signed-out context), navigates, optionally drills into a
// detail page, then writes docs/internal/help-images/<portal>/<id>.png. The HTML
// builder inlines whatever lands there; missing shots degrade to placeholders.

for (const { portal, section } of allSections()) {
  test(`${portal}/${section.id}`, async ({ browser }) => {
    const storageState =
      section.persona === "staff"
        ? STAFF_STATE
        : section.persona === "customer"
          ? CUSTOMER_STATE
          : undefined;

    const ctx = await browser.newContext({
      storageState,
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();
    try {
      const origin = section.host === "root" ? ROOT_ORIGIN : TENANT_ORIGIN;
      await page.goto(origin + section.route, { waitUntil: "networkidle", timeout: 30_000 });

      if (section.capture?.waitFor) {
        await page.waitForSelector(section.capture.waitFor, { timeout: 15_000 }).catch(() => {});
      }

      // Drill into a detail page (e.g. first invoice / quote) when asked.
      if (section.capture?.clickToDetail) {
        const link = page.locator(section.capture.clickToDetail).first();
        if (await link.count()) {
          await link.click();
          await page.waitForLoadState("networkidle").catch(() => {});
        } else {
          console.warn(`[capture] ${portal}/${section.id}: no '${section.capture.clickToDetail}' to click`);
        }
      }

      // Let fonts / images settle so the shot is crisp and deterministic.
      await page.waitForTimeout(500);

      const dir = path.join(IMAGES_DIR, portal);
      fs.mkdirSync(dir, { recursive: true });
      await page.screenshot({
        path: path.join(dir, `${section.id}.png`),
        fullPage: section.capture?.fullPage ?? false,
      });
    } finally {
      await ctx.close();
    }
  });
}
