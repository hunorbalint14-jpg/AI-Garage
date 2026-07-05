// Retrieval + prompt/answer plumbing for the support widget's manual-answering
// assistant. Pure module: no Anthropic client here, so the ranking and the
// SOURCES-line parsing are unit-testable and the corpus builds once at load.
//
// The corpus is the user manual (docs/help/manual.content.ts — outside src/,
// hence the relative import). Customer-guide sections are excluded: the widget
// serves garage staff. Anchors are portal-prefixed to match the built HTML
// (scripts/build-help-doc.ts emits id="<portal>-<sectionId>"), so a citation
// href is /staff/manual#staff-bookings, one id vocabulary end to end.
import { MANUAL, type Section, type Part } from "../../docs/help/manual.content";

export type AssistDoc = {
  /** Portal-prefixed anchor, e.g. "staff-bookings" — the id given to Claude. */
  anchor: string;
  partName: string;
  title: string;
  route: string;
  text: string;
};

export type AssistSource = { label: string; href: string; sectionId: string };

function portalOf(part: Part): string {
  if (part.name === "Customer guide") return "customer";
  if (part.name === "Staff guide") return "staff";
  return "concept";
}

function docText(section: Section): string {
  return [section.purpose, ...(section.steps ?? []), ...(section.prose ?? []), ...(section.notes ?? [])]
    .filter(Boolean)
    .join("\n");
}

function buildCorpus(): AssistDoc[] {
  const docs: AssistDoc[] = [];
  for (const part of MANUAL.parts) {
    if (part.name === "Customer guide") continue;
    const portal = portalOf(part);
    for (const section of part.sections) {
      docs.push({
        anchor: `${portal}-${section.id}`,
        partName: part.name,
        title: section.title,
        route: section.route,
        text: docText(section),
      });
    }
  }
  return docs;
}

export const ASSIST_CORPUS: AssistDoc[] = buildCorpus();

export const KNOWN_ANCHORS: Set<string> = new Set(ASSIST_CORPUS.map((d) => d.anchor));

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "what", "when", "where", "why",
  "how", "can", "cant", "does", "not", "are", "you", "your", "our", "from",
  "into", "have", "has", "had", "was", "were", "will", "would", "should",
  "about", "them", "they", "there", "their", "then", "than",
]);

export function tokenize(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length >= 3 && !STOPWORDS.has(t)),
    ),
  ];
}

function firstRouteSegment(path: string | null | undefined): string | null {
  if (!path) return null;
  const m = /^\/staff\/?([^/?#]*)/.exec(path);
  return m ? m[1] || "" : null;
}

// Keyword-overlap ranking with a route boost: 3 points per distinct question
// token found in the title, 1 per token in the body, +4 when the doc's route
// shares the current page's first /staff segment. Zero-score docs are dropped
// unless route-boosted, so an unanswerable question yields an empty set (the
// route then short-circuits to a canned "raise a ticket" answer — no model
// call, no hallucination surface).
export function rankSections(
  question: string,
  path: string | null | undefined,
  topN = 6,
): AssistDoc[] {
  const tokens = tokenize(question);
  const pageSegment = firstRouteSegment(path);

  const scored = ASSIST_CORPUS.map((doc) => {
    const title = doc.title.toLowerCase();
    const body = doc.text.toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (title.includes(t)) score += 3;
      if (body.includes(t)) score += 1;
    }
    const docSegment = firstRouteSegment(doc.route) ?? "";
    if (pageSegment !== null && pageSegment !== "" && docSegment === pageSegment) {
      score += 4; // route boost also rescues an otherwise zero-score doc
    }
    return { doc, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map((s) => s.doc);
}

// The model is instructed to end with "SOURCES: id1, id2" (or "SOURCES: none").
// Take the LAST matching line — a mid-answer literal "SOURCES:" must not win —
// strip it from the answer, and keep only anchors we actually provided.
export function parseSourcesLine(
  raw: string,
  known: Set<string> = KNOWN_ANCHORS,
): { answer: string; anchors: string[] } {
  const lines = raw.split("\n");
  let sourceIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^\s*SOURCES:/i.test(lines[i])) {
      sourceIdx = i;
      break;
    }
  }
  if (sourceIdx === -1) return { answer: raw.trim(), anchors: [] };

  const value = lines[sourceIdx].replace(/^\s*SOURCES:\s*/i, "").trim();
  const answer = [...lines.slice(0, sourceIdx), ...lines.slice(sourceIdx + 1)].join("\n").trim();
  if (!value || /^none$/i.test(value)) return { answer, anchors: [] };
  const anchors = value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => known.has(s));
  return { answer, anchors: [...new Set(anchors)] };
}

export function sourceChip(doc: AssistDoc): AssistSource {
  return {
    label: `${doc.partName.toUpperCase()} · ${doc.title.toUpperCase()}`,
    href: `/staff/manual#${doc.anchor}`,
    sectionId: doc.anchor,
  };
}

export function docByAnchor(anchor: string): AssistDoc | undefined {
  return ASSIST_CORPUS.find((d) => d.anchor === anchor);
}

export function buildAssistPrompt(
  docs: AssistDoc[],
  question: string,
  path: string | null | undefined,
): string {
  const sections = docs
    .map((d) => `[${d.anchor}] ${d.partName} — ${d.title} (route ${d.route || "n/a"})\n${d.text}`)
    .join("\n\n---\n\n");
  return `MANUAL SECTIONS:\n\n${sections}\n\nCURRENT PAGE: ${path || "unknown"}\n\nSTAFF QUESTION: ${question}`;
}
