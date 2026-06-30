import { createAdminClient } from "@/lib/supabase/admin";

// Shared quote helpers for the unified `quotes` table (Phase 2 of the quote
// unification, #242). The state-machine actions live in their colocated
// `actions.ts` files but all read/write the single `quotes` + `quote_items`
// tables and route their money maths through here, so VAT is read per-row
// instead of hard-coded.

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

type Admin = ReturnType<typeof createAdminClient>;

// The quote's stored VAT rate (percent). Falls back to the default for any
// legacy row that somehow lacks one.
export async function getQuoteVatRate(admin: Admin, quoteId: string): Promise<number> {
  const { data } = await admin.from("quotes").select("vat_rate").eq("id", quoteId).maybeSingle();
  const rate = Number((data as { vat_rate?: number | null } | null)?.vat_rate);
  return Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_VAT_RATE;
}
