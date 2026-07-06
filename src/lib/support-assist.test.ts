import { describe, it, expect } from "vitest";
import {
  ASSIST_CORPUS,
  KNOWN_ANCHORS,
  rankSections,
  parseSourcesLine,
  sourceChip,
  docByAnchor,
  buildAssistPrompt,
  tokenize,
  sanitizeHistory,
  retrievalQuery,
  canUseTool,
  ASSIST_TOOL_NAMES,
  HISTORY_MAX_MESSAGES,
  HISTORY_MAX_MSG_CHARS,
} from "./support-assist";

describe("corpus", () => {
  it("includes the customer guide (labelled) and the knowledge base", () => {
    expect(ASSIST_CORPUS.some((d) => d.partName === "Customer guide")).toBe(true);
    expect(ASSIST_CORPUS.some((d) => d.anchor.startsWith("customer-"))).toBe(true);
    expect(ASSIST_CORPUS.some((d) => d.anchor.startsWith("kb-"))).toBe(true);
  });

  it("prefixes anchors with the portal or kb-, matching the built HTML", () => {
    expect(ASSIST_CORPUS.every((d) => /^(staff|concept|customer|kb)-/.test(d.anchor))).toBe(true);
    // Spot-check a section that must exist for the widget's suggestion chips.
    expect(KNOWN_ANCHORS.has("staff-bookings")).toBe(true);
  });

  it("joins purpose/steps/prose/notes into searchable text", () => {
    const bookings = docByAnchor("staff-bookings");
    expect(bookings).toBeDefined();
    expect(bookings!.text.length).toBeGreaterThan(40);
  });

  it("KB anchors are unique against manual anchors", () => {
    expect(new Set(ASSIST_CORPUS.map((d) => d.anchor)).size).toBe(ASSIST_CORPUS.length);
  });
});

describe("tokenize", () => {
  it("drops stopwords, short tokens and punctuation", () => {
    expect(tokenize("How do I set up the bays?")).toEqual(
      expect.arrayContaining(["set", "bays"]),
    );
    expect(tokenize("How do I set up the bays?")).not.toEqual(
      expect.arrayContaining(["how", "the", "i", "up"]),
    );
  });
});

describe("rankSections", () => {
  it("ranks keyword-matching sections first", () => {
    const docs = rankSections("How do bookings work in the calendar?", null);
    expect(docs.length).toBeGreaterThan(0);
    expect(docs.some((d) => d.anchor === "staff-bookings")).toBe(true);
  });

  it("route-boosts the section for the page the user is on", () => {
    const withBoost = rankSections("something entirely unrelated zzz", "/staff/bookings/new");
    // Zero keyword hits, but the bookings doc is rescued by the route boost.
    expect(withBoost.some((d) => d.anchor === "staff-bookings")).toBe(true);
  });

  it("returns empty for gibberish with no route match", () => {
    expect(rankSections("xylophone quantum zebra", null)).toEqual([]);
  });

  it("caps at topN", () => {
    expect(rankSections("booking job invoice customer quote reminder settings", null, 3)).toHaveLength(3);
  });

  it("keyword field boosts KB entries for phrasings the body lacks", () => {
    // "bank holiday" appears in kb-opening-hours keywords.
    const docs = rankSections("are we open on the bank holiday?", null);
    expect(docs.some((d) => d.anchor === "kb-opening-hours")).toBe(true);
  });
});

describe("sourceChip", () => {
  it("links manual sections into the staff manual", () => {
    const chip = sourceChip(docByAnchor("staff-bookings")!);
    expect(chip.href).toBe("/staff/manual#staff-bookings");
  });

  it("KB entries get a link-less chip", () => {
    const kb = ASSIST_CORPUS.find((d) => d.anchor.startsWith("kb-"))!;
    expect(sourceChip(kb).href).toBeNull();
  });
});

describe("sanitizeHistory", () => {
  it("keeps only well-formed user/assistant turns", () => {
    const out = sanitizeHistory([
      { role: "user", body: "hello" },
      { role: "assistant", body: "hi" },
      { role: "system", body: "evil" },
      { role: "user", body: "" },
      { role: "user" },
      "junk",
      null,
    ]);
    expect(out).toEqual([
      { role: "user", body: "hello" },
      { role: "assistant", body: "hi" },
    ]);
  });

  it("caps message count and length", () => {
    const long = sanitizeHistory(
      Array.from({ length: 20 }, (_, i) => ({ role: "user", body: `q${i} ${"x".repeat(5000)}` })),
    );
    expect(long).toHaveLength(HISTORY_MAX_MESSAGES);
    expect(long[0].body.length).toBeLessThanOrEqual(HISTORY_MAX_MSG_CHARS);
    // Keeps the most recent messages.
    expect(long[long.length - 1].body.startsWith("q19")).toBe(true);
  });

  it("returns empty for non-arrays", () => {
    expect(sanitizeHistory(undefined)).toEqual([]);
    expect(sanitizeHistory("nope")).toEqual([]);
  });
});

describe("retrievalQuery", () => {
  it("prepends the last user question so follow-ups retrieve context", () => {
    const q = retrievalQuery("what about Sundays?", [
      { role: "user", body: "how do I change opening hours?" },
      { role: "assistant", body: "Settings → Business." },
    ]);
    expect(q).toContain("opening hours");
    expect(q).toContain("Sundays");
  });

  it("passes the question through when there is no history", () => {
    expect(retrievalQuery("plain question", [])).toBe("plain question");
  });
});

describe("canUseTool", () => {
  const owner = { orgRole: "owner" as const, isLocationMember: false };
  const admin = { orgRole: "admin" as const, isLocationMember: false };
  const accountant = { orgRole: "accountant" as const, isLocationMember: false };
  const mechanic = { orgRole: null, isLocationMember: true };

  it("open tools are open to everyone", () => {
    for (const role of [owner, admin, accountant, mechanic]) {
      expect(canUseTool("get_opening_hours", role)).toBe(true);
      expect(canUseTool("list_branches", role)).toBe(true);
      expect(canUseTool("search_past_tickets", role)).toBe(true);
    }
  });

  it("operational reads exclude accountants", () => {
    expect(canUseTool("list_services", mechanic)).toBe(true);
    expect(canUseTool("get_todays_snapshot", mechanic)).toBe(true);
    expect(canUseTool("list_services", accountant)).toBe(false);
    expect(canUseTool("get_todays_snapshot", accountant)).toBe(false);
    expect(canUseTool("list_services", owner)).toBe(true);
  });

  it("admin-surface reads need org owner/admin", () => {
    for (const tool of ["get_integration_status", "get_team_overview"] as const) {
      expect(canUseTool(tool, owner)).toBe(true);
      expect(canUseTool(tool, admin)).toBe(true);
      expect(canUseTool(tool, accountant)).toBe(false);
      expect(canUseTool(tool, mechanic)).toBe(false);
    }
  });

  it("every declared tool has a gate decision for every role shape", () => {
    for (const tool of ASSIST_TOOL_NAMES) {
      for (const role of [owner, admin, accountant, mechanic]) {
        expect(typeof canUseTool(tool, role)).toBe("boolean");
      }
    }
  });
});

describe("parseSourcesLine", () => {
  const known = new Set(["staff-bookings", "concept-overview"]);

  it("strips the trailing SOURCES line and returns known anchors", () => {
    const { answer, anchors } = parseSourcesLine(
      "Open the bookings page.\n\nSOURCES: staff-bookings, concept-overview",
      known,
    );
    expect(answer).toBe("Open the bookings page.");
    expect(anchors).toEqual(["staff-bookings", "concept-overview"]);
  });

  it("handles SOURCES: none", () => {
    const { answer, anchors } = parseSourcesLine("No idea.\nSOURCES: none", known);
    expect(answer).toBe("No idea.");
    expect(anchors).toEqual([]);
  });

  it("returns everything as answer when the line is missing", () => {
    const { answer, anchors } = parseSourcesLine("Just an answer.", known);
    expect(answer).toBe("Just an answer.");
    expect(anchors).toEqual([]);
  });

  it("strips markdown bold markers (bubble renders plain text)", () => {
    const { answer } = parseSourcesLine(
      "**Invoice.** Raise it from the job. 2 ** 3 stays.\nSOURCES: staff-bookings",
      known,
    );
    expect(answer).toBe("Invoice. Raise it from the job. 2 ** 3 stays.");
  });

  it("filters unknown ids and dedupes", () => {
    const { anchors } = parseSourcesLine(
      "A.\nSOURCES: staff-bookings, made-up, staff-bookings",
      known,
    );
    expect(anchors).toEqual(["staff-bookings"]);
  });

  it("uses the LAST SOURCES line when one appears mid-answer", () => {
    const { answer, anchors } = parseSourcesLine(
      "The manual ends pages with SOURCES: like this.\nMore text.\nSOURCES: concept-overview",
      known,
    );
    expect(answer).toContain("More text.");
    expect(anchors).toEqual(["concept-overview"]);
  });
});

describe("sourceChip", () => {
  it("labels with real part + title and links to the staff manual anchor", () => {
    const doc = docByAnchor("staff-bookings")!;
    const chip = sourceChip(doc);
    expect(chip.label).toBe(`STAFF GUIDE · ${doc.title.toUpperCase()}`);
    expect(chip.href).toBe("/staff/manual#staff-bookings");
  });
});

describe("buildAssistPrompt", () => {
  it("embeds anchors, sections, page and question", () => {
    const docs = rankSections("bookings", "/staff/bookings");
    const prompt = buildAssistPrompt(docs, "How do I book?", "/staff/bookings");
    expect(prompt).toContain("[staff-bookings]");
    expect(prompt).toContain("CURRENT PAGE: /staff/bookings");
    expect(prompt).toContain("STAFF QUESTION: How do I book?");
  });
});
