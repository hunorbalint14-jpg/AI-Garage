// Retrieval + prompt/answer plumbing for the support widget's assistant.
// Pure module: no Anthropic client here, so the ranking, role gates and the
// SOURCES-line parsing are unit-testable and the corpus builds once at load.
//
// The corpus is the user manual (docs/help/manual.content.ts — outside src/,
// hence the relative import) plus the curated assist KB
// (docs/help/assist-kb.content.ts). Customer-guide sections ARE included —
// staff often ask "what does my customer see?" — labelled with their part so
// the model can attribute them. Manual anchors are portal-prefixed to match
// the built HTML (scripts/build-help-doc.ts emits id="<portal>-<sectionId>"),
// so a citation href is /staff/manual#staff-bookings; KB entries have no
// manual anchor and render as link-less chips.
import { MANUAL, type Section, type Part } from "../../docs/help/manual.content";
import { ASSIST_KB } from "../../docs/help/assist-kb.content";

export type AssistDoc = {
  /** Portal-prefixed anchor (e.g. "staff-bookings") or "kb-<id>". */
  anchor: string;
  partName: string;
  title: string;
  route: string;
  text: string;
  /** Extra retrieval terms (KB entries only). */
  keywords?: string[];
};

export type AssistSource = { label: string; href: string | null; sectionId: string };

function portalOf(part: Part): string {
  if (part.name === "Customer guide") return "customer";
  if (part.name === "Staff guide") return "staff";
  return "concept";
}

function docText(section: Section): string {
  return [
    section.purpose,
    section.roles ? `Visible to: ${section.roles}.` : "",
    ...(section.steps ?? []),
    ...(section.prose ?? []),
    ...(section.notes ?? []),
    ...(section.troubleshooting ?? []).map((t) => `${t.problem} — ${t.fix}`),
  ]
    .filter(Boolean)
    .join("\n");
}

function buildCorpus(): AssistDoc[] {
  const docs: AssistDoc[] = [];
  for (const part of MANUAL.parts) {
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
  for (const entry of ASSIST_KB) {
    docs.push({
      anchor: `kb-${entry.id}`,
      partName: "Knowledge base",
      title: entry.title,
      route: "",
      text: entry.body,
      keywords: entry.keywords,
    });
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
    const keywords = doc.keywords ?? [];
    let score = 0;
    for (const t of tokens) {
      if (title.includes(t)) score += 3;
      if (keywords.some((k) => k.includes(t))) score += 3;
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

// The chat bubble renders plain text, so markdown bold markers the model
// sometimes emits ("**Invoice.**") would show as literal asterisks.
function stripBoldMarkers(s: string): string {
  return s.replace(/\*\*([^*]+)\*\*/g, "$1");
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
  if (sourceIdx === -1) return { answer: stripBoldMarkers(raw.trim()), anchors: [] };

  const value = lines[sourceIdx].replace(/^\s*SOURCES:\s*/i, "").trim();
  const answer = stripBoldMarkers(
    [...lines.slice(0, sourceIdx), ...lines.slice(sourceIdx + 1)].join("\n").trim(),
  );
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
    // KB entries have no section in the built manual — chip renders link-less.
    href: doc.anchor.startsWith("kb-") ? null : `/staff/manual#${doc.anchor}`,
    sectionId: doc.anchor,
  };
}

export function docByAnchor(anchor: string): AssistDoc | undefined {
  return ASSIST_CORPUS.find((d) => d.anchor === anchor);
}

// ── Conversation history ──────────────────────────────────────────────────
// The widget sends prior turns so follow-ups ("what about Sundays?") work.
// Sanitised hard: role whitelist, per-message and total caps, capped count.

export type AssistHistoryMsg = { role: "user" | "assistant"; body: string };

export const HISTORY_MAX_MESSAGES = 8;
export const HISTORY_MAX_MSG_CHARS = 2000;

export function sanitizeHistory(raw: unknown): AssistHistoryMsg[] {
  if (!Array.isArray(raw)) return [];
  const msgs: AssistHistoryMsg[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const role = (item as { role?: unknown }).role;
    const body = (item as { body?: unknown }).body;
    if (role !== "user" && role !== "assistant") continue;
    if (typeof body !== "string" || !body.trim()) continue;
    msgs.push({ role, body: body.trim().slice(0, HISTORY_MAX_MSG_CHARS) });
  }
  return msgs.slice(-HISTORY_MAX_MESSAGES);
}

// Retrieval should see the follow-up in context: rank on the current question
// plus the most recent prior user question, so "what about Sundays?" still
// surfaces the opening-hours docs.
export function retrievalQuery(question: string, history: AssistHistoryMsg[]): string {
  const lastUser = [...history].reverse().find((m) => m.role === "user");
  return lastUser ? `${lastUser.body}\n${question}` : question;
}

// ── Role gates for org-data tools ─────────────────────────────────────────
// Pure and unit-testable; the server tool executor consults this BEFORE
// running any query. Mirrors the app's own gates: config visible to all staff
// stays open, admin-surface data needs org owner/admin, team data needs
// owner/admin (matching the Team page), accountants keep finance-adjacent
// reads but no operational snapshot.

export type AssistRoleInfo = {
  orgRole: "owner" | "admin" | "accountant" | null;
  isLocationMember: boolean;
};

export const ASSIST_TOOL_NAMES = [
  "get_opening_hours",
  "list_branches",
  "list_services",
  "get_todays_snapshot",
  "get_integration_status",
  "get_team_overview",
  "search_past_tickets",
] as const;

export type AssistToolName = (typeof ASSIST_TOOL_NAMES)[number];

export function canUseTool(tool: AssistToolName, role: AssistRoleInfo): boolean {
  const isOrgAdmin = role.orgRole === "owner" || role.orgRole === "admin";
  switch (tool) {
    // Org config every staff member can already see in the app.
    case "get_opening_hours":
    case "list_branches":
    case "search_past_tickets":
      return true;
    // Branch-operational reads: branch members + org admins (accountants have
    // no operational reach — mirrors the nav gates).
    case "list_services":
    case "get_todays_snapshot":
      return role.isLocationMember || isOrgAdmin;
    // Admin settings surface.
    case "get_integration_status":
    case "get_team_overview":
      return isOrgAdmin;
  }
}

export function buildAssistPrompt(
  docs: AssistDoc[],
  question: string,
  path: string | null | undefined,
): string {
  const sections = docs.length
    ? docs
        .map((d) => `[${d.anchor}] ${d.partName} — ${d.title}${d.route ? ` (route ${d.route})` : ""}\n${d.text}`)
        .join("\n\n---\n\n")
    : "(none matched this question)";
  return `REFERENCE SECTIONS:\n\n${sections}\n\nCURRENT PAGE: ${path || "unknown"}\n\nSTAFF QUESTION: ${question}`;
}
