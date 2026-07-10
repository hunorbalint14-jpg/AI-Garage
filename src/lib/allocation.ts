// Payment allocation (#504 PR 4). Pure oldest-first allocator: a payment is
// spread across open invoices in issue order; anything left over stays
// unallocated on the payment and reports as credit on the statement.

export type OpenInvoice = {
  id: string;
  /** total − amount_paid, > 0. */
  outstanding: number;
};

export type Allocation = { invoiceId: string; amount: number };

const r2 = (n: number) => Math.round(n * 100) / 100;

export function allocatePayment(
  amount: number,
  openInvoicesOldestFirst: OpenInvoice[],
): { allocations: Allocation[]; unallocated: number } {
  let remaining = r2(Math.max(0, amount));
  const allocations: Allocation[] = [];
  for (const inv of openInvoicesOldestFirst) {
    if (remaining <= 0) break;
    const due = r2(Math.max(0, inv.outstanding));
    if (due <= 0) continue;
    const take = Math.min(remaining, due);
    allocations.push({ invoiceId: inv.id, amount: r2(take) });
    remaining = r2(remaining - take);
  }
  return { allocations, unallocated: remaining };
}
