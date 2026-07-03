import { createAdminClient } from "@/lib/supabase/admin";

// Shared quote helpers for the unified `quotes` table (Phase 2 of the quote
// unification, #242). The state-machine actions live in their colocated
// `actions.ts` files but all read/write the single `quotes` + `quote_items`
// tables and route their money maths through here, so VAT is read per-row
// instead of hard-coded.
//
// The pure money maths live in quote-service-shared.ts so client components
// (quote builders' live previews) can import them without dragging the
// service-role client into the bundle; re-exported here so server callers
// keep their existing import path.

import { DEFAULT_VAT_RATE } from "@/lib/quote-service-shared";

export {
  DEFAULT_VAT_RATE,
  computeTotals,
  type QuoteItemInput,
} from "@/lib/quote-service-shared";

type Admin = ReturnType<typeof createAdminClient>;

// The quote's stored VAT rate (percent). Falls back to the default for any
// legacy row that somehow lacks one.
export async function getQuoteVatRate(admin: Admin, quoteId: string): Promise<number> {
  const { data } = await admin.from("quotes").select("vat_rate").eq("id", quoteId).maybeSingle();
  const rate = Number((data as { vat_rate?: number | null } | null)?.vat_rate);
  return Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_VAT_RATE;
}
