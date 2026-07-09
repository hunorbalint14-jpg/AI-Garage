export const STANDARD_VAT_RATE = 20;

const round2 = (n: number) => Math.round(n * 100) / 100;

// Net unit price for a catalogue service line landing on an invoice.
//
// Service prices flagged `vat_included` (the default) are GROSS — they're what
// the customer sees on the booking widget and what Checkout charges. Job
// invoices compute VAT *exclusively* on top of line prices, so a gross price
// must have VAT backed out first or the customer is charged VAT twice over
// the advertised price (#451: £54.85 MOT online vs £65.82 via job invoice).
export function serviceNetUnitPrice(
  price: number,
  vatIncluded: boolean,
  vatRate: number = STANDARD_VAT_RATE,
): number {
  const p = Number(price) || 0;
  if (!vatIncluded) return round2(p);
  return round2(p / (1 + vatRate / 100));
}
