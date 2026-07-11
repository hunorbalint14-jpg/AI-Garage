import base from "./playwright.screenshots.config";
import { defineConfig } from "@playwright/test";

// Per-PR live-drive harness: runs `e2e/screenshots/pr-*.spec.ts` against an
// ALREADY-RUNNING dev server (npm run dev + local Supabase). The pr-*.spec.ts
// files themselves are throwaway per-PR drives and stay untracked (.gitignore)
// — this config is the stable part. Usage:
//   npx playwright test -c playwright.pr.config.ts e2e/screenshots/pr-<x>.spec.ts
export default defineConfig({
  ...base,
  timeout: 120_000,
  webServer: { ...base.webServer!, reuseExistingServer: true },
  projects: [
    ...(base.projects ?? []),
    {
      name: "pr",
      testMatch: /pr-.*\.spec\.ts/,
      dependencies: ["setup"],
    },
  ],
});
