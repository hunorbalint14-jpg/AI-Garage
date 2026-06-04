import { defineConfig } from "vitest/config";

export default defineConfig({
  // Vite 8 resolves tsconfig `paths` (the `@/…` alias) natively, replacing the
  // vite-tsconfig-paths plugin.
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // `include` already scopes to src/**, but exclude the Playwright e2e dir
    // explicitly so its *.spec.ts files never get pulled into the unit runner.
    exclude: ["**/node_modules/**", "**/.next/**", "supabase/**", "e2e/**"],
    // Default env is node. For a DOM test, add `// @vitest-environment jsdom`
    // at the top of that file — vitest 4 removed `environmentMatchGlobs`.
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/test/**",
        "src/app/**/page.tsx",
        "src/app/**/layout.tsx",
        "src/components/**/*.tsx",
        "**/*.d.ts",
      ],
    },
  },
});
