import { test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { shotSections } from "../../docs/help/manual.content";
import { latestRelease } from "../../src/lib/release-notes";
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
//
// Sections with `stepper` entries additionally get one shot per step
// (`<id>--<n>.png`), produced by that section's ACTION below.

// Per-section scripted interactions. `base` runs before the main shot; `steps`
// produce the stepper shots in order (the page state accumulates between them).
type SectionAction = {
  base?: (page: Page) => Promise<void>;
  steps?: ((page: Page) => Promise<void>)[];
};

const ACTIONS: Record<string, SectionAction> = {
  // Support widget: base shot = panel open on the chat view. Stepper: launcher →
  // an answered question → the escalate form.
  "staff/support": {
    base: async (page) => {
      await page.getByRole("button", { name: "Support", exact: true }).click();
      await page.waitForSelector("text=ANSWERS FIRST", { timeout: 10_000 });
      await page.waitForTimeout(400);
    },
    steps: [
      // 1: launcher (panel closed) — close it first.
      async (page) => {
        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);
      },
      // 2: ask a question and wait for the answer.
      async (page) => {
        await page.getByRole("button", { name: "Support", exact: true }).click();
        await page.waitForSelector("text=ANSWERS FIRST", { timeout: 10_000 });
        await page.getByPlaceholder("Ask anything about AI Garage…").fill("How do I change our opening hours?");
        await page.keyboard.press("Enter");
        await page.waitForSelector("text=Still stuck", { timeout: 60_000 }).catch(() => {});
        await page.waitForTimeout(300);
      },
      // 3: the escalate form (prefilled from the chat).
      async (page) => {
        const still = page.getByRole("button", { name: /Still stuck/ });
        if (await still.isVisible().catch(() => false)) await still.click();
        await page.waitForSelector("text=ATTACHED AUTOMATICALLY", { timeout: 10_000 }).catch(() => {});
        await page.waitForTimeout(1200);
      },
    ],
  },
  // Purchase orders: expand the seeded draft so the supplier-ordering actions
  // (Send to supplier / Import confirmation) are in the shot (#568).
  "staff/purchase-orders": {
    base: async (page) => {
      const draft = page.getByText("PO-DEMO-002");
      if (await draft.count()) {
        await draft.first().click();
        await page.waitForSelector("text=Send to supplier", { timeout: 10_000 }).catch(() => {});
        await page.waitForTimeout(400);
      }
    },
  },
  // Suppliers: open the ordering panel so the setup fields are visible.
  "staff/suppliers": {
    base: async (page) => {
      const badge = page.getByText("Email + link");
      if (await badge.count()) {
        await badge.first().click();
        await page.waitForSelector("text=How purchase orders reach", { timeout: 10_000 }).catch(() => {});
        await page.waitForTimeout(400);
      }
    },
  },
  // Go live: the interesting state is a PRELIVE branch, and the seed leaves
  // Eastside prelive for exactly this. Switch to it through the real branch
  // picker (which sets the cookie server-side), then come back to the page.
  "staff/go-live": {
    base: async (page) => {
      await page.goto(page.url().replace("/staff/go-live", "/staff/select-branch"), {
        waitUntil: "domcontentloaded",
      });
      const eastside = page.getByRole("button", { name: /Eastside/ }).first();
      if (await eastside.count()) {
        await eastside.click();
        await page.waitForURL(/\/staff$/, { timeout: 20_000 }).catch(() => {});
      }
      await page.goto(page.url().replace(/\/staff.*$/, "/staff/go-live"), { waitUntil: "domcontentloaded" });
      await page.waitForSelector("text=What will send", { timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(500);
    },
  },
  // Bookings list reads best in list view for the register shot… keep month for
  // the calendar feel; no action needed.
};

async function settle(page: Page) {
  await page
    .addStyleTag({
      content:
        "nextjs-portal,[data-next-badge-root],[data-nextjs-toast],#__next-build-watcher{display:none!important}",
    })
    .catch(() => {});
  await page.waitForTimeout(500);
}

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
    // Pre-acknowledge the cookie banner and dismiss the what's-new popup
    // (both localStorage-gated) before any page script runs, so neither
    // renders into a screenshot.
    await ctx.addInitScript((seenVersion) => {
      try {
        localStorage.setItem("ai-garage-cookies-acknowledged", "1");
        localStorage.setItem("whats-new-seen", seenVersion);
      } catch {
        /* storage unavailable — ignore */
      }
    }, latestRelease().version);
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
      // transitional/blank frame). `clickSequence` chains several clicks (only
      // the last one is expected to navigate).
      const clicks = section.capture?.clickSequence ?? (section.capture?.clickToDetail ? [section.capture.clickToDetail] : []);
      for (const selector of clicks) {
        const link = page.locator(selector).first();
        if (await link.count()) {
          const before = page.url();
          await link.click();
          await page.waitForURL((u) => u.toString() !== before, { timeout: 15_000 }).catch(() => {});
          await page.waitForLoadState("domcontentloaded").catch(() => {});
          await page.waitForTimeout(1200);
        } else {
          console.warn(`[capture] ${portal}/${section.id}: no '${selector}' to click`);
        }
      }

      const action = ACTIONS[`${portal}/${section.id}`];
      if (action?.base) await action.base(page);

      // Let fonts / images settle so the shot is crisp and deterministic.
      await settle(page);

      const dir = path.join(IMAGES_DIR, portal);
      fs.mkdirSync(dir, { recursive: true });
      await page.screenshot({
        path: path.join(dir, `${section.id}.png`),
        fullPage: section.capture?.fullPage ?? false,
      });

      // Stepper shots (state accumulates between steps).
      if (section.stepper?.length && action?.steps) {
        for (let i = 0; i < section.stepper.length; i++) {
          const stepFn = action.steps[i];
          if (stepFn) await stepFn(page);
          await settle(page);
          await page.screenshot({ path: path.join(dir, `${section.id}--${i + 1}.png`), fullPage: false });
        }
      }
    } finally {
      await ctx.close();
    }
  });
}
