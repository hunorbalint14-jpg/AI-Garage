import { describe, expect, it } from "vitest";
import { buildStatement, type StatementInvoice, type StatementPayment } from "./statement";

const NOW = new Date("2026-07-11T12:00:00Z");

const inv = (n: string, issued: string, due: string, total: number, paid = 0, status = "sent"): StatementInvoice => ({
  id: n,
  invoice_number: n,
  issued_at: issued,
  due_at: due,
  total,
  amount_paid: paid,
  status,
});
const pay = (id: string, date: string, amount: number): StatementPayment => ({
  id,
  received_at: date,
  amount,
  method: "bank_transfer",
  reference: null,
});

describe("buildStatement", () => {
  it("opening + running balance + closing reconcile to the penny", () => {
    const s = buildStatement({
      invoices: [inv("INV-1", "2026-05-10", "2026-06-09", 600), inv("INV-2", "2026-06-05", "2026-07-05", 240)],
      payments: [pay("p1", "2026-05-20", 200), pay("p2", "2026-06-15", 400)],
      fromIso: "2026-06-01T00:00:00Z",
      toIso: "2026-07-01T00:00:00Z",
      now: NOW,
    });
    expect(s.opening).toBe(400); // 600 − 200 before June
    expect(s.lines.map((l) => l.balance)).toEqual([640, 240]); // +240 inv, −400 pay
    expect(s.closing).toBe(240);
  });

  it("aging buckets on outstanding, not raw totals", () => {
    const s = buildStatement({
      invoices: [
        inv("cur", "2026-07-01", "2026-07-31", 100), // not yet due
        inv("d30", "2026-06-01", "2026-07-01", 200, 50), // 10 days overdue, £150 left
        inv("d90", "2026-01-01", "2026-02-01", 300), // ancient
        inv("paid", "2026-06-01", "2026-07-01", 500, 500, "paid"), // excluded
      ],
      payments: [],
      fromIso: "2026-07-01T00:00:00Z",
      toIso: "2026-08-01T00:00:00Z",
      now: NOW,
    });
    expect(s.aging).toEqual({ current: 100, d30: 150, d60: 0, d90: 300 });
    expect(s.totalOutstanding).toBe(550);
  });

  it("invoices settled outside the ledger get a synthetic settlement credit", () => {
    // Paid via Stripe / mark-paid: status flips but no payments row exists and
    // amount_paid stays at the ledger-allocated share (here £100 of £600).
    const stripePaid: StatementInvoice = {
      ...inv("INV-1", "2026-06-05", "2026-07-05", 600, 100, "paid"),
      paid_at: "2026-06-20",
    };
    const s = buildStatement({
      invoices: [stripePaid],
      payments: [pay("p1", "2026-06-10", 100)],
      fromIso: "2026-06-01T00:00:00Z",
      toIso: "2026-07-01T00:00:00Z",
      now: NOW,
    });
    // +600 invoice, −100 ledger payment, −500 settlement on the paid date.
    expect(s.lines.map((l) => l.balance)).toEqual([600, 500, 0]);
    expect(s.lines[2].reference).toBe("INV-1 settled");
    expect(s.closing).toBe(0);
  });

  it("null issued_at never NaNs into the opening balance", () => {
    // Regression: a paid invoice with no issued_at made every date comparison
    // NaN-false and its total leaked into opening, permanently.
    const s = buildStatement({
      invoices: [
        { ...inv("JUNK", "2026-07-10", "2026-07-10", 232.2, 0, "paid"), issued_at: null, paid_at: "2026-07-10" },
        inv("INV-1", "2026-05-01", "2026-05-31", 150),
      ],
      payments: [],
      fromIso: "2026-06-01T00:00:00Z",
      toIso: "2026-07-01T00:00:00Z",
      now: NOW,
    });
    expect(s.opening).toBe(150); // JUNK charges + settles in July, not before June
    expect(s.closing).toBe(150);
  });

  it("drafts never appear; empty period keeps opening = closing", () => {
    const s = buildStatement({
      invoices: [inv("draft", "2026-06-01", "2026-07-01", 999, 0, "draft"), inv("INV-1", "2026-05-01", "2026-05-31", 120)],
      payments: [],
      fromIso: "2026-06-01T00:00:00Z",
      toIso: "2026-07-01T00:00:00Z",
      now: NOW,
    });
    expect(s.opening).toBe(120);
    expect(s.lines).toHaveLength(0);
    expect(s.closing).toBe(120);
  });
});
