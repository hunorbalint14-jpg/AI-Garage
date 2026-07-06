import { describe, it, expect } from "vitest";
import {
  RELEASE_NOTES,
  hasFreshRelease,
  draftEntryFromSubject,
  draftFromSubjects,
  nextVersion,
} from "./release-notes";

describe("release notes data", () => {
  it("is newest-first with valid ISO dates and unique versions", () => {
    const dates = RELEASE_NOTES.map((r) => new Date(r.date).getTime());
    expect(dates.every((d) => !Number.isNaN(d))).toBe(true);
    expect([...dates].sort((a, b) => b - a)).toEqual(dates);
    expect(new Set(RELEASE_NOTES.map((r) => r.version)).size).toBe(RELEASE_NOTES.length);
  });
});

describe("hasFreshRelease", () => {
  const latest = new Date(RELEASE_NOTES[0].date);
  it("true within the window, false after", () => {
    expect(hasFreshRelease(new Date(latest.getTime() + 86_400_000))).toBe(true);
    expect(hasFreshRelease(new Date(latest.getTime() + 20 * 86_400_000))).toBe(false);
  });
});

describe("draftEntryFromSubject", () => {
  it("maps conventional types and strips scope + PR ref", () => {
    expect(draftEntryFromSubject("feat(support-widget): floating widget (#436)")).toEqual({
      kind: "new",
      title: "floating widget",
    });
    expect(draftEntryFromSubject("fix(staff): align finance gates (#432)")).toEqual({
      kind: "fixed",
      title: "align finance gates",
    });
    expect(draftEntryFromSubject("perf: faster dashboard")).toEqual({
      kind: "improved",
      title: "faster dashboard",
    });
  });

  it("drops non-tenant-facing types and dependency bumps", () => {
    expect(draftEntryFromSubject("chore(db): drop stats v1 (#431)")).toBeNull();
    expect(draftEntryFromSubject("docs: update readme")).toBeNull();
    expect(draftEntryFromSubject("refactor: split module")).toBeNull();
    expect(draftEntryFromSubject("fix(deps): bump next from 16.2.8 to 16.2.9")).toBeNull();
    expect(draftEntryFromSubject("not a conventional subject")).toBeNull();
  });
});

describe("draftFromSubjects", () => {
  it("filters and maps a mixed list", () => {
    const out = draftFromSubjects([
      "feat: a (#1)",
      "chore: b",
      "fix: c",
    ]);
    expect(out).toEqual([
      { kind: "new", title: "a" },
      { kind: "fixed", title: "c" },
    ]);
  });
});

describe("nextVersion", () => {
  const july = new Date("2026-07-15");
  it("uses YYYY.MM, then suffixes on collision", () => {
    expect(nextVersion(july, [])).toBe("2026.07");
    expect(nextVersion(july, ["2026.07"])).toBe("2026.07.2");
    expect(nextVersion(july, ["2026.07", "2026.07.2"])).toBe("2026.07.3");
  });
});
