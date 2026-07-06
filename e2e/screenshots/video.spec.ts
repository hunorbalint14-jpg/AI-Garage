import { test, type Browser, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { TENANT_ORIGIN, STAFF_STATE, CUSTOMER_STATE } from "./helpers";
import { latestRelease } from "../../src/lib/release-notes";

// Screen recordings for the manual's `video` sections. Each flow records a
// short, non-destructive walkthrough into docs/internal/help-videos/
// <portal>/<id>.webm — the file name must match the manifest section id. The
// builder embeds whatever lands there; a missing video simply isn't rendered.
//
// Keep flows read-mostly: they run against the seeded demo tenant and must
// leave it in a state the still-capture suite can re-shoot.

const REPO = process.cwd();
const VIDEOS_DIR = path.join(REPO, "docs/internal/help-videos");
const SIZE = { width: 1280, height: 720 };

async function record(
  browser: Browser,
  opts: { portal: "staff" | "customer"; id: string; storageState?: string },
  flow: (page: Page) => Promise<void>,
) {
  const ctx = await browser.newContext({
    storageState: opts.storageState,
    viewport: SIZE,
    recordVideo: { dir: path.join(VIDEOS_DIR, ".tmp"), size: SIZE },
  });
  await ctx.addInitScript((seenVersion) => {
    try {
      localStorage.setItem("ai-garage-cookies-acknowledged", "1");
      localStorage.setItem("whats-new-seen", seenVersion);
    } catch {
      /* ignore */
    }
  }, latestRelease().version);
  const page = await ctx.newPage();
  try {
    await flow(page);
  } finally {
    const video = page.video();
    await ctx.close(); // finalises the recording
    if (video) {
      const tmp = await video.path();
      const dir = path.join(VIDEOS_DIR, opts.portal);
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(tmp, path.join(dir, `${opts.id}.webm`));
      fs.rmSync(tmp, { force: true });
    }
  }
}

// Small human-feeling pause so the video doesn't teleport between states.
const beat = (page: Page, ms = 900) => page.waitForTimeout(ms);

test("video staff/bookings — around the calendar and into a booking", async ({ browser }) => {
  await record(browser, { portal: "staff", id: "bookings", storageState: STAFF_STATE }, async (page) => {
    await page.goto(`${TENANT_ORIGIN}/staff/bookings`, { waitUntil: "domcontentloaded" });
    await beat(page, 1500);
    // Month → list → open the first booking.
    const list = page.getByText("List", { exact: true }).first();
    if (await list.isVisible().catch(() => false)) {
      await list.click();
      await beat(page, 1400);
    }
    const row = page.locator("a[href*='/staff/bookings/']").first();
    if (await row.count()) {
      await row.click();
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      await beat(page, 2200);
    }
  });
});

test("video customer/quote-detail — reviewing a quote", async ({ browser }) => {
  await record(browser, { portal: "customer", id: "quote-detail", storageState: CUSTOMER_STATE }, async (page) => {
    await page.goto(`${TENANT_ORIGIN}/dashboard/quotes`, { waitUntil: "domcontentloaded" });
    await beat(page, 1500);
    const quote = page.locator("a[href*='/dashboard/quotes/']").first();
    if (await quote.count()) {
      await quote.click();
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      await beat(page, 1800);
      // Scroll through the items so the viewer sees the whole quote; stop short
      // of clicking Approve (the flow must stay non-destructive for re-runs).
      await page.mouse.wheel(0, 400);
      await beat(page, 1200);
      await page.mouse.wheel(0, -400);
      await beat(page, 1200);
    }
  });
});

test("video staff/support — ask the assistant, then the ticket form", async ({ browser }) => {
  await record(browser, { portal: "staff", id: "support", storageState: STAFF_STATE }, async (page) => {
    await page.goto(`${TENANT_ORIGIN}/staff`, { waitUntil: "domcontentloaded" });
    await beat(page, 1200);
    await page.getByRole("button", { name: "Support", exact: true }).click();
    await page.waitForSelector("text=ANSWERS FIRST", { timeout: 10_000 });
    await beat(page, 800);
    const input = page.getByPlaceholder("Ask anything about AI Garage…");
    await input.pressSequentially("How do quote reminders send?", { delay: 35 });
    await page.keyboard.press("Enter");
    await page.waitForSelector("text=Still stuck", { timeout: 60_000 }).catch(() => {});
    await beat(page, 1600);
    const still = page.getByRole("button", { name: /Still stuck/ });
    if (await still.isVisible().catch(() => false)) {
      await still.click();
      await page.waitForSelector("text=ATTACHED AUTOMATICALLY", { timeout: 10_000 }).catch(() => {});
      await beat(page, 2000);
    }
  });
});
