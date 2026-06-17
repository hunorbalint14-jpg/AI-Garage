// Client-facing comms must name the *branch*, not just the organisation — a
// customer of a multi-location org needs to know which physical site to attend.
// These helpers turn an (org name, branch name, branch address) triple into the
// strings every email/SMS/WhatsApp shares, so the wording stays consistent and
// single-location orgs never see a redundant "Smith Motors — Smith Motors".

export type GarageIdentity = {
  orgName: string;
  /** The branch / location name. Omitted or equal-to-org → not appended. */
  locationName?: string | null;
  /** The branch's freeform postal address (locations.address). */
  address?: string | null;
};

// "Smith Motors — Camden". The branch is appended only when it actually differs
// from the org name (single-location orgs name their one branch after the org).
export function garageLabel({ orgName, locationName }: GarageIdentity): string {
  const org = (orgName ?? "").trim();
  const loc = (locationName ?? "").trim();
  if (!loc || loc.toLowerCase() === org.toLowerCase()) return org;
  return `${org} — ${loc}`;
}

// Collapse a freeform multi-line address to one line for SMS / WhatsApp:
// "12 High St\nCamden\nNW1 0AB" → "12 High St, Camden, NW1 0AB". Null when empty.
export function addressOneLine(address?: string | null): string | null {
  const a = (address ?? "").trim();
  if (!a) return null;
  return a
    .split(/\s*\n\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(", ");
}

// Multi-line "where to attend" block for an email body. Branch label on the
// first line, the address (as entered) beneath it. Just the label when no
// address is set, so the line is always safe to drop into a confirmation.
export function garageLocationBlock(g: GarageIdentity): string {
  const label = garageLabel(g);
  const a = (g.address ?? "").trim();
  return a ? `${label}\n${a}` : label;
}

// One-line variant for SMS / WhatsApp: "Smith Motors — Camden, 12 High St, …".
export function garageLocationInline(g: GarageIdentity): string {
  const label = garageLabel(g);
  const a = addressOneLine(g.address);
  return a ? `${label}, ${a}` : label;
}
