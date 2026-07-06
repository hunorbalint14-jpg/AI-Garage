/*
 * Draft the next release-notes entry from commits merged since the last one.
 *
 *   npm run notes:draft
 *
 * Reads the newest release date from src/lib/release-notes.ts, walks
 * `git log` for conventional-commit subjects since then, and prints a draft
 * ReleaseNote block to paste at the TOP of RELEASE_NOTES. Titles come from PR
 * subjects — rewrite them into plain English for garage staff before
 * committing (that's the point of the human step).
 *
 * feat→new, fix→fixed, perf→improved; chore/docs/refactor/test and dependency
 * bumps are dropped.
 */
import { execFileSync } from "node:child_process";
import {
  RELEASE_NOTES,
  draftFromSubjects,
  nextVersion,
} from "../src/lib/release-notes";

const since = RELEASE_NOTES[0]?.date;
const args = ["log", "--pretty=%s", "--no-merges"];
if (since) args.push(`--since=${since} 00:00:00`);

const subjects = execFileSync("git", args, { encoding: "utf-8" })
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean);

const entries = draftFromSubjects(subjects);

if (entries.length === 0) {
  console.log(`No tenant-facing commits since ${since ?? "the beginning"} — nothing to draft.`);
  process.exit(0);
}

const today = new Date();
const version = nextVersion(today, RELEASE_NOTES.map((r) => r.version));
const iso = today.toISOString().slice(0, 10);

const block = [
  `  {`,
  `    version: ${JSON.stringify(version)},`,
  `    date: ${JSON.stringify(iso)},`,
  `    summary: "", // one sentence for the heading`,
  `    entries: [`,
  ...entries.map(
    (e) =>
      `      { kind: ${JSON.stringify(e.kind)}, title: ${JSON.stringify(e.title)} }, // ← rewrite for staff`,
  ),
  `    ],`,
  `  },`,
].join("\n");

console.log(
  `Draft for ${version} (${entries.length} entries from ${subjects.length} commits since ${since ?? "start"}).\n` +
    `Paste at the TOP of RELEASE_NOTES in src/lib/release-notes.ts and rewrite the titles:\n`,
);
console.log(block);
