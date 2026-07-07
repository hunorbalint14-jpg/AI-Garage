import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Regression guard for the org-scoped tenancy bug (#463): the tenant subdomain
// resolves to the ORGANISATION slug, so tenant URLs must be built from
// `organization.slug`, never a branch/location slug. This flags any
// tenantOrigin()/tenantQuoteUrl() call whose first argument is a `location.slug`
// / `loc.slug` (incl. `ctx.location.slug`, `b.location.slug`, `q.location.slug`).
const BAD = /tenant(?:Origin|QuoteUrl)\(\s*[^,)]*\b(?:loc|location)\.slug\b/;

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(p);
  }
  return out;
}

describe("tenant URL guard (#463)", () => {
  it("never builds a tenant subdomain from a branch/location slug", () => {
    const offenders = walk(SRC)
      .filter((f) => BAD.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(SRC.length + 1).replace(/\\/g, "/"));
    expect(
      offenders,
      `Build tenant subdomains from the ORG slug (organization.slug), not a branch slug:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });
});
