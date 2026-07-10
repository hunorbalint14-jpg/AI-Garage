// Tenant-facing release notes, rendered at /staff/whats-new. Newest first.
//
// Maintained by hand (the copy is for garage staff, not developers); draft a
// new release from merged PRs with `npm run notes:draft`, then edit the titles
// into plain English before committing. Versions are CalVer: "YYYY.MM", with a
// ".2" suffix if a month gets more than one entry.

export type ReleaseEntryKind = "new" | "improved" | "fixed";

export type ReleaseEntry = {
  kind: ReleaseEntryKind;
  /** One line, plain English, tenant-facing. */
  title: string;
  /** Optional second sentence of detail. */
  body?: string;
};

export type ReleaseNote = {
  /** CalVer label, e.g. "2026.07". */
  version: string;
  /** ISO date the release note was published. */
  date: string;
  /** One-sentence summary shown under the version heading. */
  summary?: string;
  entries: ReleaseEntry[];
};

export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: "2026.07.2",
    date: "2026-07-10",
    summary:
      "Digital vehicle health checks: grade a car on your phone, let AI write the customer wording, and get work approved item by item.",
    entries: [
      {
        kind: "new",
        title: "Vehicle health checks on your phone (beta)",
        body: "Open a job and tap Health check. Grade the exceptions red or amber with photos, then confirm the rest are OK in one tap — a 33-point check in under five minutes.",
      },
      {
        kind: "new",
        title: "AI turns tech shorthand into customer-friendly wording",
        body: "“osf lower arm bush split” becomes a clear explanation of what was found and why it matters. Every line stays editable before it goes out, and the flow works without AI too.",
      },
      {
        kind: "new",
        title: "Customers approve work item by item from the report",
        body: "Send the branded report by email, SMS or WhatsApp — photos, urgency and a price per finding. Approved items land straight on the job; deposits, reminders and expiry work exactly like quotes.",
      },
      {
        kind: "new",
        title: "Previously advised work follows the vehicle",
        body: "Declined or unquoted advisories appear on the customer's record and on the vehicle's next job, so nothing gets forgotten.",
      },
    ],
  },
  {
    version: "2026.07",
    date: "2026-07-06",
    summary: "Help that comes to you: in-app support with an assistant that knows your garage, plus a completely rebuilt user manual.",
    entries: [
      {
        kind: "new",
        title: "Support widget on every staff page",
        body: "The life-ring next to the bell answers questions instantly and raises tickets to the AI Garage team without leaving the page — replies land right back in the widget.",
      },
      {
        kind: "new",
        title: "The assistant knows your garage",
        body: "Ask about your own opening hours, services or whether Stripe is connected — it answers from your real settings and respects each person's role.",
      },
      {
        kind: "new",
        title: "Rebuilt user manual",
        body: "Every page documented, with search, walkthrough videos, step-by-step guides and troubleshooting boxes. Open it from the support widget's citations or at /staff/manual.",
      },
      {
        kind: "improved",
        title: "Support widget works properly on phones and tablets",
        body: "Bottom-sheet layout, no more zooming when you type, and the toast notifications fit the screen.",
      },
      {
        kind: "improved",
        title: "Role-aware dashboard",
        body: "Owners see the money, mechanics see their day — the dashboard now leads with what your role needs.",
      },
      {
        kind: "fixed",
        title: "Finance pages now match what accountants can see in the navigation",
      },
    ],
  },
];

/** Newest release (the array is maintained newest-first). */
export function latestRelease(): ReleaseNote {
  return RELEASE_NOTES[0];
}

/** True while the newest release is fresh enough to badge in the nav. */
export function hasFreshRelease(now: Date = new Date(), days = 14): boolean {
  const latest = RELEASE_NOTES[0];
  if (!latest) return false;
  const age = now.getTime() - new Date(latest.date).getTime();
  return age >= 0 && age < days * 86_400_000;
}

// ── Draft generation (used by scripts/generate-release-notes.ts; pure and
//    unit-tested here) ────────────────────────────────────────────────────────

/** Map a conventional-commit subject to a draft entry, or null to skip. */
export function draftEntryFromSubject(subject: string): ReleaseEntry | null {
  // "feat(scope): title (#123)" — capture type and title, drop the PR ref.
  const m = /^(\w+)(?:\([^)]*\))?(!)?:\s*(.+?)(?:\s*\(#\d+\))?$/.exec(subject.trim());
  if (!m) return null;
  const [, type, , title] = m;
  const kind: ReleaseEntryKind | null =
    type === "feat" ? "new" : type === "fix" ? "fixed" : type === "perf" ? "improved" : null;
  if (!kind) return null; // chore/docs/refactor/test/build → not tenant-facing
  // Dependabot / lockfile noise.
  if (/^bump |^update .*dependenc/i.test(title)) return null;
  return { kind, title };
}

/** Draft entries from a list of commit subjects (newest first is fine). */
export function draftFromSubjects(subjects: string[]): ReleaseEntry[] {
  return subjects
    .map(draftEntryFromSubject)
    .filter((e): e is ReleaseEntry => e !== null);
}

/** Next CalVer for a given date, deduping against existing versions. */
export function nextVersion(date: Date, existing: string[]): string {
  const base = `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}`;
  if (!existing.includes(base)) return base;
  let n = 2;
  while (existing.includes(`${base}.${n}`)) n++;
  return `${base}.${n}`;
}
