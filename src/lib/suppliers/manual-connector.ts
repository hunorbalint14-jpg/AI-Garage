// The launch connector: no supplier API at all.
//
// Ordering is a structured email to the factor's parts desk (or, when they only
// take web orders, a punch-out deep link into their own basket). Confirmations
// come back as text a human pastes in — parseConfirmation reads them.
// Deliberately degraded: no live availability, no electronic acknowledgement.
// It works with ANY factor on day one, which is the point — the trade-API
// connectors replace it supplier by supplier without any caller changing.

import { sendEmail } from "@/lib/email";
import { renderSupplierOrderEmail } from "./order-email";
import { buildPunchoutUrl } from "./punchout";
import type {
  ConnectorError,
  OrderRequest,
  PlacedOrder,
  QuoteRequest,
  QuoteResult,
  ResolvedSupplierIntegration,
  SupplierConnector,
} from "./types";

export function manualConnector(integration: ResolvedSupplierIntegration): SupplierConnector {
  return {
    kind: "manual",

    // No API to price against — the best this connector can do is hand the
    // user to the supplier's catalogue. Callers treat "unavailable" as the cue
    // to fall back to AI/manual part entry (#567).
    async quote(req: QuoteRequest): Promise<QuoteResult> {
      const url = buildPunchoutUrl(integration.punchoutUrlTemplate, { reg: req.reg, query: req.query });
      if (url) return { outcome: "punchout", url };
      return {
        outcome: "unavailable",
        reason: `${integration.supplierName} has no catalogue link set up — add one in Suppliers, or enter the part by hand.`,
      };
    },

    // Email wins when the supplier has an order address: it actually sends the
    // order and leaves a record. Punch-out is the fallback hand-off, where
    // nothing has been sent yet and a human finishes in the supplier's basket.
    async placeOrder(req: OrderRequest): Promise<PlacedOrder | ConnectorError> {
      const to = integration.effectiveOrderEmail;
      if (to) {
        const { subject, text, html } = renderSupplierOrderEmail(req, {
          accountNumber: integration.accountNumber,
          supplierName: integration.supplierName,
        });
        const result = await sendEmail({ to, subject, text, html });
        if (!result.success) {
          return { error: result.error ?? `Could not email the order to ${to}.` };
        }
        return { channel: "email", supplierOrderRef: null, url: null, sentTo: to };
      }

      const url = buildPunchoutUrl(integration.punchoutUrlTemplate, {
        query: req.lines.map((l) => l.sku ?? l.description).join(" "),
      });
      if (url) return { channel: "punchout", supplierOrderRef: null, url, sentTo: null };

      return {
        error: `${integration.supplierName} has no order email or catalogue link — add one in Suppliers before sending.`,
      };
    },

    // Nothing to poll. Confirmations are pasted in and parsed.
    async fetchConfirmation(): Promise<null> {
      return null;
    },
  };
}
