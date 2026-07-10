// Client-safe half of work-auth (#503): pure maths + types. NO server-only
// imports — the counter-signature sheet shows the inc-VAT total before the
// customer signs, so this must be importable from client components (the
// -shared split rule; the admin-client half lives in work-auth.ts).

export type AuthItemSnapshot = {
  description: string;
  type: string;
  quantity: number;
  unit_price: number; // ex-VAT, as stored on job_items
  vat_rate: number; // percent snapshot (#514 per-line model)
};

// The figure the customer says yes to: line totals plus per-line VAT — the
// same maths the invoice will bill.
export function authorisedTotal(items: Pick<AuthItemSnapshot, "quantity" | "unit_price" | "vat_rate">[]): number {
  const total = items.reduce((sum, it) => {
    const net = (Number(it.quantity) || 0) * (Number(it.unit_price) || 0);
    return sum + net * (1 + (Number(it.vat_rate) || 0) / 100);
  }, 0);
  return Math.round(total * 100) / 100;
}
