// Pure half of quote-service.ts, importable from client components (the other
// half pulls in the service-role Supabase client, which must stay server-only).
// Keep this module dependency-free.

export type QuoteItemInput = {
  description: string;
  type: "part" | "labour" | "other";
  quantity: number;
  unit_price: number;
  product_id?: string | null;
};

// Default VAT rate (%) applied to a newly drafted quote. The per-row
// `quotes.vat_rate` is the source of truth once the row exists — never assume
// 20 on read/approve.
export const DEFAULT_VAT_RATE = 20;

// Subtotal / VAT / total from line items at a given VAT percentage. The rate is
// always passed in (from the quote row, or DEFAULT_VAT_RATE at creation).
export function computeTotals(
  items: Pick<QuoteItemInput, "quantity" | "unit_price">[],
  vatRate: number = DEFAULT_VAT_RATE,
): { subtotal: number; vat: number; total: number } {
  const subtotal = items.reduce(
    (sum, it) => sum + Number(it.quantity || 0) * Number(it.unit_price || 0),
    0,
  );
  const subtotalRounded = Math.round(subtotal * 100) / 100;
  const vat = Math.round(subtotalRounded * vatRate) / 100;
  const total = Math.round((subtotalRounded + vat) * 100) / 100;
  return { subtotal: subtotalRounded, vat, total };
}
