import { test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { shotSections } from "../../docs/help/manual.content";
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

for (const { portal, section } of shotSections()) {
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
    // Pre-acknowledge the cookie banner (it's localStorage-gated) before any page
    // script runs, so it never renders into a screenshot.
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem("ai-garage-cookies-acknowledged", "1");
      } catch {
        /* storage unavailable — ignore */
      }
    });
    const page = await ctx.newPage();
    try {
      const origin = section.host === "root" ? ROOT_ORIGIN : TENANT_ORIGIN;
      // domcontentloaded, not networkidle: Next dev keeps an HMR websocket open,
      // so networkidle never settles and every goto would time out.
      await page.goto(origin + section.route, { waitUntil: "domcontentloaded", timeout: 30_000 });

      if (section.capture?.waitFor) {
        await page.waitForSelector(section.capture.waitFor, { timeout: 15_000 }).catch(() => {});
      }

      // Drill into a detail page (e.g. first invoice / quote) when asked. Wait
      // for the URL to actually change (App Router client nav streams the RSC
      // payload — a plain domcontentloaded fires too early and shoots the
      // transitional/blank frame).
      if (section.capture?.clickToDetail) {
        const link = page.locator(section.capture.clickToDetail).first();
        if (await link.count()) {
          const before = page.url();
          await link.click();
          await page.waitForURL((u) => u.toString() !== before, { timeout: 15_000 }).catch(() => {});
          await page.waitForLoadState("domcontentloaded").catch(() => {});
          await page.waitForTimeout(1200);
        } else {
          console.warn(`[capture] ${portal}/${section.id}: no '${section.capture.clickToDetail}' to click`);
        }
      }

      // Hide the Next.js dev indicator — it only shows in dev, never in a manual.
      await page
        .addStyleTag({
          content:
            "nextjs-portal,[data-next-badge-root],[data-nextjs-toast],#__next-build-watcher{display:none!important}",
        })
        .catch(() => {});

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
