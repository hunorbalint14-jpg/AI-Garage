"use client";

import { startFinanceApplication } from "./finance-actions";
import { SpreadTheCostCard } from "@/components/finance/spread-the-cost-card";
import type { FinanceAddressInput } from "@/lib/finance";

// Quote-page binding of the shared "Spread the cost" card: the quote link
// (slug + token) is the credential, so we close over it and hand the card a
// pre-bound start action.

type Props = {
  slug: string;
  token: string;
  primaryColor: string;
  totalFormatted: string;
};

export function SpreadTheCost({ slug, token, primaryColor, totalFormatted }: Props) {
  return (
    <SpreadTheCostCard
      start={(address: FinanceAddressInput) => startFinanceApplication(slug, token, address)}
      primaryColor={primaryColor}
      totalFormatted={totalFormatted}
    />
  );
}
