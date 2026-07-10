// Account statement builder (#504 PR 4). Pure: opening balance, the
// period's invoices and payments in date order with a running balance, the
// closing balance, and aging buckets computed on OUTSTANDING amounts
// (total − amount_paid), never raw totals.

export type StatementInvoice = {
  id: string;
  invoice_number: string;
  issued_at: string | null; // date; null falls back to paid_at/due_at
  due_at: string; // date
  total: number;
  amount_paid: number;
  status: string;
  /** Needed to place the settlement credit for invoices paid OUTSIDE the
   * ledger (Stripe, mark-paid) — see the synthetic events below. */
  paid_at?: string | null;
};

export type StatementPayment = {
  id: string;
  received_at: string; // date
  amount: number;
  method: string;
  reference: string | null;
};

export type StatementLine = {
  date: string;
  kind: "invoice" | "payment";
  reference: string;
  debit: number | null; // invoice total
  credit: number | null; // payment amount
  balance: number; // running
};

export type AgingBuckets = { current: number; d30: number; d60: number; d90: number };

export type Statement = {
  opening: number;
  lines: StatementLine[];
  closing: number;
  /** Aging of what's outstanding NOW across all open invoices given. */
  aging: AgingBuckets;
  totalOutstanding: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function buildStatement(args: {
  invoices: StatementInvoice[]; // ALL of the account's invoices (any period)
  payments: StatementPayment[]; // ALL payments
  fromIso: string;
  toIso: string;
  now?: Date;
}): Statement {
  const from = new Date(args.fromIso).getTime();
  const to = new Date(args.toIso).getTime();
  const now = args.now ?? new Date();

  // A null/invalid date would make every comparison below NaN-false and the
  // event silently land in the opening balance — fall back rather than trust
  // issued_at alone.
  const chargeDate = (i: StatementInvoice) => i.issued_at ?? i.paid_at ?? i.due_at;
  const invoiceEvents = args.invoices
    .filter((i) => i.status !== "draft" && chargeDate(i))
    .map((i) => ({ date: chargeDate(i)!, kind: "invoice" as const, ref: i.invoice_number, amount: Number(i.total) }));
  const paymentEvents = args.payments.map((p) => ({
    date: p.received_at,
    kind: "payment" as const,
    ref: [p.method.replace(/_/g, " "), p.reference].filter(Boolean).join(" · "),
    amount: Number(p.amount),
  }));
  // Invoices settled outside the ledger (Stripe checkout, staff mark-paid)
  // have no payments rows — without a synthetic settlement credit they'd
  // inflate the running balance forever. `amount_paid` is written only by
  // the ledger allocator, so `total − amount_paid` is exactly the share the
  // ledger did NOT record.
  const settlementEvents = args.invoices
    .filter((i) => i.status === "paid" && Number(i.total) - Number(i.amount_paid ?? 0) > 0)
    .map((i) => ({
      date: i.paid_at ?? i.issued_at ?? i.due_at,
      kind: "payment" as const,
      ref: `${i.invoice_number} settled`,
      amount: r2(Number(i.total) - Number(i.amount_paid ?? 0)),
    }));
  const all = [...invoiceEvents, ...paymentEvents, ...settlementEvents].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime() || (a.kind === "invoice" ? -1 : 1),
  );

  let opening = 0;
  for (const e of all) {
    if (new Date(e.date).getTime() >= from) continue;
    opening = r2(opening + (e.kind === "invoice" ? e.amount : -e.amount));
  }

  let balance = opening;
  const lines: StatementLine[] = [];
  for (const e of all) {
    const t = new Date(e.date).getTime();
    if (t < from || t >= to) continue;
    balance = r2(balance + (e.kind === "invoice" ? e.amount : -e.amount));
    lines.push({
      date: e.date,
      kind: e.kind,
      reference: e.ref,
      debit: e.kind === "invoice" ? r2(e.amount) : null,
      credit: e.kind === "payment" ? r2(e.amount) : null,
      balance,
    });
  }

  // Aging on outstanding-now, bucketed by days past due.
  const aging: AgingBuckets = { current: 0, d30: 0, d60: 0, d90: 0 };
  let totalOutstanding = 0;
  for (const i of args.invoices) {
    if (i.status !== "sent") continue;
    const outstanding = r2(Math.max(0, Number(i.total) - Number(i.amount_paid ?? 0)));
    if (outstanding <= 0) continue;
    totalOutstanding = r2(totalOutstanding + outstanding);
    const overdueDays = Math.floor((now.getTime() - new Date(i.due_at).getTime()) / 86_400_000);
    if (overdueDays <= 0) aging.current = r2(aging.current + outstanding);
    else if (overdueDays <= 30) aging.d30 = r2(aging.d30 + outstanding);
    else if (overdueDays <= 60) aging.d60 = r2(aging.d60 + outstanding);
    else aging.d90 = r2(aging.d90 + outstanding);
  }

  return { opening, lines, closing: balance, aging, totalOutstanding };
}
