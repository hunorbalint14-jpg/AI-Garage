// Punch-out URL building — deep-link a staff member into the supplier's own
// catalogue, pre-filled with the vehicle and the part they're looking for.
// Pure (no server imports) so both the settings form and the job screen can
// validate a template client-side.

export const PUNCHOUT_PLACEHOLDERS = ["{reg}", "{query}"] as const;

/**
 * Substitute {reg} / {query} into a supplier's catalogue URL template.
 *
 * Returns null when the template is blank or isn't an http(s) URL — a
 * supplier-supplied string ends up in an anchor href, so anything else
 * (javascript:, data:) must never make it out of here.
 *
 * Placeholders are optional: a template that is just the catalogue home page
 * is valid, it simply lands the user on the front page.
 */
export function buildPunchoutUrl(
  template: string | null | undefined,
  vars: { reg?: string | null; query?: string | null } = {},
): string | null {
  const raw = template?.trim();
  if (!raw) return null;

  const substituted = raw
    .replaceAll("{reg}", encodeURIComponent((vars.reg ?? "").trim()))
    .replaceAll("{query}", encodeURIComponent((vars.query ?? "").trim()));

  let url: URL;
  try {
    url = new URL(substituted);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url.toString();
}

/** Whether a template is usable — same rules as buildPunchoutUrl. */
export function isValidPunchoutTemplate(template: string | null | undefined): boolean {
  return buildPunchoutUrl(template, { reg: "AB12CDE", query: "test" }) !== null;
}
