import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { SENTRY_DATA_COLLECTION } from "../../sentry.data-collection";

// Sentry v11 collects user info, cookies, headers, bodies, query params, DB
// query data, AI prompts and stack-frame locals UNLESS told not to. This app
// holds multi-tenant customer PII, so every category that can carry it is off.
// (The Required<…> type on SENTRY_DATA_COLLECTION separately fails typecheck
// if a Sentry upgrade adds a new category.)

describe("SENTRY_DATA_COLLECTION", () => {
  it("collects nothing that can carry customer data", () => {
    expect(SENTRY_DATA_COLLECTION).toEqual({
      userInfo: false,
      cookies: false,
      httpHeaders: { request: false, response: false },
      httpBodies: [],
      urlQueryParams: false, // public links carry their access token as ?t=
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      frameContextLines: 5, // our own source lines, not customer data
    });
  });
});

describe("every Sentry.init() uses it", () => {
  const repo = process.cwd();

  function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...sourceFiles(p));
      else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
    }
    return out;
  }

  const rootConfigs = readdirSync(repo)
    .filter((f) => /^sentry\..+\.config\.ts$/.test(f))
    .map((f) => path.join(repo, f));
  const inits = [...rootConfigs, ...sourceFiles(path.join(repo, "src"))]
    .map((file) => ({ file: path.relative(repo, file), src: readFileSync(file, "utf8") }))
    .filter(({ src }) => src.includes("Sentry.init("));

  it("finds the server, edge and browser configs", () => {
    expect(inits.map((i) => i.file.replace(/\\/g, "/")).sort()).toEqual(
      expect.arrayContaining(["sentry.edge.config.ts", "sentry.server.config.ts", "src/instrumentation-client.ts"]),
    );
  });

  it("passes dataCollection: SENTRY_DATA_COLLECTION — a bare Sentry.init() collects everything in v11", () => {
    for (const { file, src } of inits) {
      expect(src, `${file} calls Sentry.init() without the shared dataCollection`).toMatch(
        /dataCollection:\s*SENTRY_DATA_COLLECTION/,
      );
    }
  });
});
