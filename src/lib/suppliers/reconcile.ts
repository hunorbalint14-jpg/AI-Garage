// Match the lines on a pasted supplier confirmation back to the lines on our
// purchase order, so confirmed costs land on the right rows.
//
// Kept pure and separate from the action because this is where a wrong answer
// is expensive: matching the wrong line rewrites a cost, which flows into job
// margin. The rules run strongest-first and every match is one-to-one — a line
// we can't place with confidence is reported as unmatched for a human to
// handle, never guessed at.

import type { ConfirmedLine } from "./types";

export type ReconcilableItem = {
  id: string;
  description: string;
  /** SKU of the linked product, when the PO line has one. */
  sku: string | null;
};

export type LineMatch = {
  itemId: string;
  /** Confirmed unit cost ex VAT. */
  unitCost: number;
  /** The confirmation line it came from, for the summary. */
  confirmed: ConfirmedLine;
};

export type Reconciliation = {
  matches: LineMatch[];
  /** Confirmation lines we couldn't place on the order. */
  unmatched: ConfirmedLine[];
};

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function reconcileConfirmation(
  items: ReconcilableItem[],
  confirmed: ConfirmedLine[],
): Reconciliation {
  const takenItems = new Set<string>();
  const matches: LineMatch[] = [];
  const unmatched: ConfirmedLine[] = [];

  const prepared = items.map((it) => ({
    ...it,
    normDescription: normalise(it.description),
    normSku: it.sku ? normalise(it.sku) : null,
  }));

  // Strongest rule first across ALL lines before falling back, so a line with
  // a real SKU match isn't stolen by another line's loose text match.
  const rules: ((line: ConfirmedLine) => (typeof prepared)[number] | undefined)[] = [
    (line) => {
      if (!line.sku) return undefined;
      const sku = normalise(line.sku);
      return prepared.find((it) => !takenItems.has(it.id) && it.normSku && it.normSku === sku);
    },
    // The SKU is often typed into the free-text description of a PO line.
    (line) => {
      if (!line.sku) return undefined;
      const sku = normalise(line.sku);
      if (sku.length < 4) return undefined;
      return prepared.find((it) => !takenItems.has(it.id) && it.normDescription.includes(sku));
    },
    (line) => {
      const desc = normalise(line.description);
      return prepared.find((it) => !takenItems.has(it.id) && it.normDescription === desc);
    },
    (line) => {
      const desc = normalise(line.description);
      if (desc.length < 4) return undefined;
      return prepared.find(
        (it) =>
          !takenItems.has(it.id) &&
          it.normDescription.length >= 4 &&
          (it.normDescription.includes(desc) || desc.includes(it.normDescription)),
      );
    },
  ];

  let remaining = [...confirmed];
  for (const rule of rules) {
    const stillRemaining: ConfirmedLine[] = [];
    for (const line of remaining) {
      const hit = rule(line);
      if (hit) {
        takenItems.add(hit.id);
        matches.push({ itemId: hit.id, unitCost: line.unitCost, confirmed: line });
      } else {
        stillRemaining.push(line);
      }
    }
    remaining = stillRemaining;
  }
  unmatched.push(...remaining);

  return { matches, unmatched };
}
