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
} from "./support-assist";

describe("corpus", () => {
  it("excludes the customer guide entirely", () => {
    expect(ASSIST_CORPUS.some((d) => d.partName === "Customer guide")).toBe(false);
    expect(ASSIST_CORPUS.some((d) => d.anchor.startsWith("customer-"))).toBe(false);
  });

  it("prefixes anchors with the portal, matching the built HTML", () => {
    expect(ASSIST_CORPUS.every((d) => /^(staff|concept)-/.test(d.anchor))).toBe(true);
    // Spot-check a section that must exist for the widget's suggestion chips.
    expect(KNOWN_ANCHORS.has("staff-bookings")).toBe(true);
  });

  it("joins purpose/steps/prose/notes into searchable text", () => {
    const bookings = docByAnchor("staff-bookings");
    expect(bookings).toBeDefined();
    expect(bookings!.text.length).toBeGreaterThan(40);
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
