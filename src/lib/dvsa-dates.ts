// DVSA dates appear as ISO ("2026-01-17T14:23:21.000Z"), bare dates, or the
// legacy "2026.01.17 14:23:21" form depending on payload vintage. Normalise to
// YYYY-MM-DD; null for anything unparseable.
//
// Lives in its own module so both the delta pipeline (dvsa-bulk.ts) and the
// MOT persistence layer (mot-history.ts) share one parser — they previously
// diverged, and the stricter of the two silently dropped legacy-format tests.
export function parseDvsaDate(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length < 10) return null;
  const datePart = raw.slice(0, 10).replace(/\./g, "-");
  return /^\d{4}-\d{2}-\d{2}$/.test(datePart) ? datePart : null;
}
