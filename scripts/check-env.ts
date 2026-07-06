/*
 * Production environment checklist — verifies the env vars this app needs.
 *
 *   npm run check:env      # checks the current process env (loads .env.local locally)
 *
 * Exits non-zero if any CORE var is missing (the app is broken without it), and
 * warns about missing FEATURE vars (that feature silently degrades). Run it in
 * the deploy pipeline, or paste the prod env and run it, before pointing a real
 * garage at the app. The spec + checker live in src/lib/env-checklist.ts (so
 * they're unit-tested in CI); this is just the CLI. Doc:
 * docs/production-env-checklist.md.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkEnv, ENV_VARS } from "../src/lib/env-checklist";

function loadDotEnvLocal() {
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const p = path.join(repo, ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf-8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
}

loadDotEnvLocal();
const r = checkEnv(process.env);

if (r.coreMissing.length) {
  console.error(`\n❌ CORE vars missing (${r.coreMissing.length}) — the app will not function:`);
  for (const name of r.coreMissing) {
    const v = ENV_VARS.find((x) => x.name === name)!;
    console.error(`   ${name}  [${v.group}] — ${v.ifMissing}`);
  }
} else {
  console.log("\n✅ All CORE vars present.");
}

const featureGaps = [
  ...r.featureMissing.map((v) => ({ name: v.name, group: v.group, msg: v.ifMissing })),
  ...r.oneOfMissing.map((g) => ({
    name: g.options.map((s) => s.join("+")).join(" OR "),
    group: g.group,
    msg: g.ifMissing,
  })),
];
if (featureGaps.length) {
  console.warn(`\n⚠️  FEATURE vars missing (${featureGaps.length}) — these features silently degrade:`);
  for (const g of featureGaps) console.warn(`   ${g.name}  [${g.group}] — ${g.msg}`);
} else {
  console.log("✅ All FEATURE vars present.");
}

if (r.devOnlySet.length) {
  console.warn(`\n⚠️  DEV-ONLY vars set (${r.devOnlySet.length}) — must NOT be present in production: ${r.devOnlySet.join(", ")}`);
}

console.log("");
process.exit(r.coreMissing.length ? 1 : 0);
