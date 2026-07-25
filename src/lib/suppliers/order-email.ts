// The structured order email the manual connector sends to a factor. It has to
// stand on its own in a parts desk inbox: who is ordering (org + BRANCH, per
// the comms rule), the trade account it goes against, our PO reference to quote
// back, and an unambiguous line table.
//
// Split from manual-connector.ts so the shaping is unit-testable without
// touching Resend.

import { renderBrandedEmail, paragraphsToHtml } from "@/lib/email";
import { garageLocationBlock } from "@/lib/garage-identity";
import type { OrderRequest } from "./types";

function money(n: number): string {
  return `£${n.toFixed(2)}`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type SupplierOrderEmail = { subject: string; text: string; html: string };

export function renderSupplierOrderEmail(
  req: OrderRequest,
  opts: { accountNumber: string | null; supplierName: string },
): SupplierOrderEmail {
  const identity = garageLocationBlock({
    orgName: req.orgName,
    locationName: req.locationName,
    address: req.locationAddress,
  });

  const total = req.lines.reduce((sum, l) => sum + l.quantity * l.unitCost, 0);
  const subject = `Parts order ${req.reference} — ${req.orgName}`;

  const textLines = req.lines
    .map(
      (l) =>
        `  ${l.quantity} x ${l.description}${l.sku ? ` (${l.sku})` : ""} @ ${money(l.unitCost)} = ${money(l.quantity * l.unitCost)}`,
    )
    .join("\n");

  const text = [
    `Parts order ${req.reference}`,
    "",
    identity,
    opts.accountNumber ? `Trade account: ${opts.accountNumber}` : null,
    "",
    "Please supply:",
    textLines,
    "",
    `Estimated total (ex VAT): ${money(total)} — prices are our expected cost, please confirm.`,
    req.notes ? `\nNotes: ${req.notes}` : null,
    "",
    `Please confirm with your order reference, quoting ${req.reference}.`,
  ]
    .filter((l) => l !== null)
    .join("\n");

  const rows = req.lines
    .map(
      (l) => `<tr>
      <td style="padding:6px 10px;border-bottom:1px solid #26262b;font-size:13px">${esc(l.description)}${l.sku ? `<br><span style="opacity:.6;font-size:11px">${esc(l.sku)}</span>` : ""}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #26262b;font-size:13px;text-align:right">${l.quantity}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #26262b;font-size:13px;text-align:right">${money(l.unitCost)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #26262b;font-size:13px;text-align:right">${money(l.quantity * l.unitCost)}</td>
    </tr>`,
    )
    .join("");

  const table = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:14px 0;border-collapse:collapse">
    <tr>
      <th align="left" style="padding:6px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;opacity:.6">Part</th>
      <th align="right" style="padding:6px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;opacity:.6">Qty</th>
      <th align="right" style="padding:6px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;opacity:.6">Unit</th>
      <th align="right" style="padding:6px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;opacity:.6">Line</th>
    </tr>${rows}</table>`;

  const bodyHtml = [
    paragraphsToHtml(
      `Please supply the parts below against order ${req.reference}.${req.notes ? `\n\n${req.notes}` : ""}`,
    ),
    table,
    paragraphsToHtml(
      `Prices shown are our expected cost ex VAT — please confirm. Reply with your order reference, quoting ${req.reference}.`,
    ),
  ].join("");

  const html = renderBrandedEmail({
    brandName: req.orgName,
    heading: `Parts order ${req.reference}`,
    badge: "Order",
    preheader: `${req.lines.length} line${req.lines.length === 1 ? "" : "s"} for ${opts.supplierName}`,
    bodyHtml,
    details: [
      { label: "Ordering branch", value: identity.replace(/\n/g, ", ") },
      ...(opts.accountNumber ? [{ label: "Trade account", value: opts.accountNumber }] : []),
      { label: "Our reference", value: req.reference },
      { label: "Estimated total (ex VAT)", value: money(total) },
    ],
    footerNote: req.replyTo ? `Reply to ${req.replyTo}` : undefined,
  });

  return { subject, text, html };
}
