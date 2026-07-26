// Damage markers for a courtesy-car loan — the diagram UK hire desks mark at
// hand-over and again at return.
//
// Codes and size bands follow common UK hire condition-report practice; the
// fair-wear thresholds quoted in FAIR_WEAR_HINT come from the published rental
// policies (Avis: surface scratches under ~25mm and stone chips under ~3mm;
// Europcar: dents under ~20mm needing no repaint), which sit under the BVRLA
// fair-wear-and-tear standard. They are guidance shown to staff, not a rule the
// app enforces — what is chargeable is the garage's call.

export const DAMAGE_VIEWS = ["front", "offside", "rear", "nearside", "wheels"] as const;
export type DamageView = (typeof DAMAGE_VIEWS)[number];

export const DAMAGE_VIEW_LABELS: Record<DamageView, string> = {
  front: "Front",
  offside: "Offside (driver)",
  rear: "Rear",
  nearside: "Nearside (passenger)",
  wheels: "Wheels & tyres",
};

export const DAMAGE_CODES = ["S", "D", "C", "CR", "SF", "M", "R"] as const;
export type DamageCode = (typeof DAMAGE_CODES)[number];

export const DAMAGE_CODE_LABELS: Record<DamageCode, string> = {
  S: "Scratch",
  D: "Dent",
  C: "Chip",
  CR: "Crack",
  SF: "Scuff",
  M: "Missing",
  R: "Rust",
};

// "scratch" and "missing"/"rust" don't take a bare -s.
const DAMAGE_CODE_PLURALS: Record<DamageCode, string> = {
  S: "scratches",
  D: "dents",
  C: "chips",
  CR: "cracks",
  SF: "scuffs",
  M: "missing items",
  R: "rust spots",
};

export const DAMAGE_SIZES = ["S", "M", "L"] as const;
export type DamageSize = (typeof DAMAGE_SIZES)[number];

export const DAMAGE_SIZE_LABELS: Record<DamageSize, string> = {
  S: "Small · up to 50mm",
  M: "Medium · 50–200mm",
  L: "Large · over 200mm",
};

export const FAIR_WEAR_HINT =
  "Hire-trade guidance: surface scratches under 25mm, stone chips under 3mm and dents under 20mm needing no repaint are normally fair wear.";

export type DamageMarker = {
  id: string;
  view: DamageView;
  /** Position as a percentage of the view box, so the diagram can scale freely. */
  x: number;
  y: number;
  code: DamageCode;
  size: DamageSize;
  note: string | null;
};

export const DAMAGE_MAX_MARKERS = 40;
const NOTE_MAX = 120;

function clampPct(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n * 10) / 10));
}

/**
 * Coerce untrusted JSON (a client payload, or a row written by an older build)
 * into markers we can render. Anything unrecognised is dropped rather than
 * throwing — a bad marker must never make a loan's diagram unreadable.
 */
export function parseDamageMarkers(input: unknown): DamageMarker[] {
  if (!Array.isArray(input)) return [];
  const out: DamageMarker[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const m = raw as Record<string, unknown>;
    const view = m.view as DamageView;
    const code = m.code as DamageCode;
    const size = m.size as DamageSize;
    if (!DAMAGE_VIEWS.includes(view)) continue;
    if (!DAMAGE_CODES.includes(code)) continue;
    const note = typeof m.note === "string" ? m.note.trim().slice(0, NOTE_MAX) : "";
    out.push({
      id: typeof m.id === "string" && m.id ? m.id.slice(0, 40) : `m${out.length + 1}`,
      view,
      x: clampPct(m.x),
      y: clampPct(m.y),
      code,
      size: DAMAGE_SIZES.includes(size) ? size : "S",
      note: note || null,
    });
    if (out.length >= DAMAGE_MAX_MARKERS) break;
  }
  return out;
}

/** One-line summary for the loan card / diary, e.g. "2 scratches, 1 dent". */
export function summariseDamage(markers: DamageMarker[]): string {
  if (markers.length === 0) return "";
  const counts = new Map<DamageCode, number>();
  for (const m of markers) counts.set(m.code, (counts.get(m.code) ?? 0) + 1);
  return [...counts.entries()]
    .map(([code, n]) => `${n} ${n === 1 ? DAMAGE_CODE_LABELS[code].toLowerCase() : DAMAGE_CODE_PLURALS[code]}`)
    .join(", ");
}

let markerSeq = 0;

/**
 * Mint a marker id that is unique across BOTH the check-out and the return
 * session — the return diagram is seeded with the check-out markers and
 * `newDamage` keys on the id, so a repeat would file new damage as pre-existing.
 *
 * Deliberately not `crypto.randomUUID()`: that is secure-context only, so it
 * throws on any plain-http origin and the marker would silently never land.
 * The counter covers one page session, the random suffix covers across them,
 * and `taken` closes the gap entirely for ids we can actually see.
 */
export function nextMarkerId(taken: Iterable<string> = []): string {
  const used = new Set(taken);
  for (let attempt = 0; attempt < 100; attempt++) {
    markerSeq += 1;
    const id = `m-${markerSeq.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    if (!used.has(id)) return id;
  }
  return `m-${markerSeq.toString(36)}-${Date.now().toString(36)}`;
}

/** Markers present at return but not at check-out — the damage to charge for. */
export function newDamage(out: DamageMarker[], back: DamageMarker[]): DamageMarker[] {
  const seen = new Set(out.map((m) => m.id));
  return back.filter((m) => !seen.has(m.id));
}
