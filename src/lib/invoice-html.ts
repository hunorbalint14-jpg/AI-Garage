// Branded invoice HTML used by both staff sendInvoice (PR #84) and the
// auto-generated booking invoice flow (PR #89). Lives outside any
// "use server" file so non-action callers (webhook routes, cron) can use it.

export type InvoiceHtmlArgs = {
  invoiceNumber: string;
  issuedAt: string;
  dueAt: string;
  garageName: string;
  /** Issuing branch name (omitted when it matches the org / single-site). */
  locationName?: string | null;
  /** Issuing branch postal address — printed on the invoice (legal/VAT). */
  garageAddress?: string | null;
  garagePhone: string | null;
  garageEmail: string | null;
  logoUrl: string | null;
  brandColor: string;
  customerName: string;
  items: { description: string; type: string; quantity: number; unit_price: number }[];
  subtotal: number;
  vatRate: number;
  vatAmount: number;
  total: number;
  discountAmount?: number;
  discountDescription?: string | null;
  membershipCreditAmount?: number;
  membershipCreditDescription?: string | null;
  notes: string | null;
  payUrl: string | null;
};

export function buildInvoiceHtml(args: InvoiceHtmlArgs): string {
  const {
    invoiceNumber, issuedAt, dueAt, garageName, locationName, garageAddress, garagePhone, garageEmail,
    logoUrl, brandColor, customerName, items, subtotal, vatRate, vatAmount, total,
    discountAmount, discountDescription, membershipCreditAmount, membershipCreditDescription, notes, payUrl,
  } = args;
  const fmt = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
  const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // Issuing branch + address block (HTML-escaped). The branch name is only
  // shown when it differs from the org/brand; the address always prints when set.
  const branchName =
    locationName && locationName.trim() && locationName.trim().toLowerCase() !== garageName.trim().toLowerCase()
      ? locationName.trim()
      : null;
  const locationLine = [
    branchName ? escapeHtml(branchName) : null,
    garageAddress?.trim() ? escapeHtml(garageAddress.trim()).replace(/\n/g, "<br>") : null,
  ]
    .filter(Boolean)
    .join("<br>");
  const adjustmentRow = (label: string, amount: number) => `<tr>
                <td style="padding:8px 0;color:#6b7280;font-size:14px">${escapeHtml(label)}</td>
                <td align="right" style="padding:8px 0;color:#15803d;font-size:14px">− ${fmt(amount)}</td>
              </tr>`;
  const creditRow =
    membershipCreditAmount && membershipCreditAmount > 0
      ? adjustmentRow(membershipCreditDescription ?? "Included in membership", membershipCreditAmount)
      : "";
  const discountRow =
    discountAmount && discountAmount > 0
      ? adjustmentRow(discountDescription ?? "Discount", discountAmount)
      : "";
  const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  const onBrand = (() => {
    try {
      const h = brandColor.replace("#", "");
      const r = parseInt(h.slice(0, 2), 16);
      const g = parseInt(h.slice(2, 4), 16);
      const b = parseInt(h.slice(4, 6), 16);
      return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55 ? "#0e1014" : "#ffffff";
    } catch { return "#ffffff"; }
  })();

  const rows = items.map((it, idx) => `
    <tr${idx % 2 === 1 ? ' style="background:#fafafa"' : ""}>
      <td data-label="Item" style="padding:14px 16px;border-bottom:1px solid #f1f5f9;color:#111827">
        <div style="font-weight:600">${it.description}</div>
        <div style="font-size:12px;color:#6b7280;text-transform:capitalize;margin-top:2px">${it.type}</div>
      </td>
      <td data-label="Qty" style="padding:14px 16px;border-bottom:1px solid #f1f5f9;text-align:right;color:#374151;white-space:nowrap">${it.quantity}</td>
      <td data-label="Unit" style="padding:14px 16px;border-bottom:1px solid #f1f5f9;text-align:right;color:#374151;white-space:nowrap">${fmt(it.unit_price)}</td>
      <td data-label="Total" style="padding:14px 16px;border-bottom:1px solid #f1f5f9;text-align:right;color:#111827;font-weight:600;white-space:nowrap">${fmt(it.quantity * it.unit_price)}</td>
    </tr>`).join("");

  const contactLine = [garagePhone, garageEmail].filter(Boolean).join(" · ");

  const logoBlock = logoUrl
    ? `<img src="${logoUrl}" alt="${garageName}" height="48" style="display:block;max-height:48px;width:auto;border:0;outline:none">`
    : `<div style="font-size:22px;font-weight:700;color:#0f172a;letter-spacing:-0.01em">${garageName}</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Invoice ${invoiceNumber}</title>
<style>
  body { margin:0; padding:0; background:#f3f4f6; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; color:#111827; -webkit-font-smoothing:antialiased; }
  table { border-collapse:collapse; }
  a { color:${brandColor}; text-decoration:none; }
  @media only screen and (max-width: 600px) {
    .container { padding:16px !important; }
    .card { border-radius:0 !important; }
    .hero { padding:24px 20px !important; }
    .hero-name { font-size:18px !important; }
    .hero-amount { font-size:24px !important; }
    .items-wrap { padding:16px !important; }
    .items, .items thead, .items tbody, .items th, .items td, .items tr { display:block; }
    .items thead { display:none; }
    .items tr { padding:12px; border:1px solid #e5e7eb; border-radius:8px; margin-bottom:10px; }
    .items td { border:none !important; padding:4px 0 !important; text-align:left !important; }
    .items td:before { content: attr(data-label) ": "; font-weight:600; color:#6b7280; text-transform:uppercase; font-size:11px; letter-spacing:.04em; }
    .totals { padding:16px !important; }
    .meta-grid td { display:block !important; width:100% !important; padding:6px 0 !important; }
  }
</style>
</head>
<body>
<div class="container" style="max-width:680px;margin:0 auto;padding:32px 20px">
  <div class="card" style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.04)">

    <div class="hero" style="background:${brandColor};padding:32px 32px;color:${onBrand}">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td valign="top" style="padding:0">
            <div style="margin-bottom:12px">${logoBlock}</div>
            <div class="hero-name" style="font-size:20px;font-weight:600;color:${onBrand};opacity:0.95">${garageName}</div>
            ${locationLine ? `<div style="font-size:13px;margin-top:4px;color:${onBrand};opacity:0.85">${locationLine}</div>` : ""}
            ${contactLine ? `<div style="font-size:13px;margin-top:4px;color:${onBrand};opacity:0.8">${contactLine}</div>` : ""}
          </td>
          <td valign="top" align="right" style="padding:0;white-space:nowrap">
            <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.12em;opacity:0.75;color:${onBrand}">Invoice</div>
            <div style="font-size:15px;font-family:'SF Mono',Menlo,Consolas,monospace;margin-top:4px;color:${onBrand};opacity:0.95">${invoiceNumber}</div>
            <div class="hero-amount" style="font-size:28px;font-weight:700;margin-top:16px;color:${onBrand}">${fmt(total)}</div>
          </td>
        </tr>
      </table>
    </div>

    <div style="padding:24px 32px;border-bottom:1px solid #f1f5f9;background:#fafafa">
      <table role="presentation" class="meta-grid" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td valign="top" style="padding:0 12px 0 0;width:40%">
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;font-weight:600;margin-bottom:6px">Bill to</div>
            <div style="font-size:15px;font-weight:600;color:#111827">${customerName}</div>
          </td>
          <td valign="top" style="padding:0 12px;width:30%">
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;font-weight:600;margin-bottom:6px">Issued</div>
            <div style="font-size:14px;color:#374151">${fmtDate(issuedAt)}</div>
          </td>
          <td valign="top" style="padding:0 0 0 12px;width:30%">
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;font-weight:600;margin-bottom:6px">Due</div>
            <div style="font-size:14px;font-weight:600;color:#111827">${fmtDate(dueAt)}</div>
          </td>
        </tr>
      </table>
    </div>

    <div class="items-wrap" style="padding:24px 32px">
      <table role="presentation" class="items" width="100%" cellpadding="0" cellspacing="0" border="0">
        <thead>
          <tr>
            <th align="left" style="padding:0 16px 10px;font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;font-weight:600;border-bottom:2px solid #e5e7eb">Item</th>
            <th align="right" style="padding:0 16px 10px;font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;font-weight:600;border-bottom:2px solid #e5e7eb">Qty</th>
            <th align="right" style="padding:0 16px 10px;font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;font-weight:600;border-bottom:2px solid #e5e7eb">Unit</th>
            <th align="right" style="padding:0 16px 10px;font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;font-weight:600;border-bottom:2px solid #e5e7eb">Total</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>

    <div class="totals" style="padding:0 32px 24px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td></td>
          <td align="right" style="padding:0;width:240px">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="padding:8px 0;color:#6b7280;font-size:14px">Subtotal</td>
                <td align="right" style="padding:8px 0;color:#374151;font-size:14px">${fmt(subtotal)}</td>
              </tr>
              ${creditRow}
              ${discountRow}
              <tr>
                <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:14px">VAT (${vatRate}%)</td>
                <td align="right" style="padding:8px 0;border-bottom:1px solid #e5e7eb;color:#374151;font-size:14px">${fmt(vatAmount)}</td>
              </tr>
              <tr>
                <td style="padding:14px 0 0;font-weight:700;font-size:16px;color:#0f172a">${payUrl ? "Total due" : "Total paid"}</td>
                <td align="right" style="padding:14px 0 0;font-weight:700;font-size:18px;color:${brandColor}">${fmt(total)}</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </div>

    ${payUrl ? `
    <div style="padding:24px 32px;background:#ffffff;border-top:1px solid #f1f5f9;text-align:center">
      <a href="${payUrl}" style="display:inline-block;background:${brandColor};color:${onBrand};font-weight:600;font-size:15px;text-decoration:none;padding:14px 28px;border-radius:8px;border:0">Pay ${fmt(total)} now →</a>
      <p style="font-size:11px;color:#9ca3af;margin:10px 0 0">Secure card payment via Stripe.</p>
    </div>` : `
    <div style="padding:18px 32px;background:#dcfce7;border-top:1px solid #bbf7d0;text-align:center">
      <p style="font-size:14px;color:#15803d;font-weight:600;margin:0">✓ Paid in full</p>
    </div>`}

    ${notes ? `
    <div style="padding:20px 32px;background:#fafafa;border-top:1px solid #f1f5f9;font-size:13px;color:#4b5563;line-height:1.6">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;font-weight:600;margin-bottom:6px">Notes</div>
      ${notes}
    </div>` : ""}

    <div style="padding:20px 32px;background:#f9fafb;border-top:1px solid #f1f5f9;text-align:center">
      <div style="font-size:12px;color:#6b7280">Thank you for your business — ${garageName}</div>
      ${contactLine ? `<div style="font-size:12px;color:#9ca3af;margin-top:4px">${contactLine}</div>` : ""}
    </div>
  </div>

  <p style="text-align:center;font-size:11px;color:#9ca3af;margin:16px 0 0">
    Sent via AI Garage · <a href="https://ai-garage.co.uk/privacy" style="color:#9ca3af;text-decoration:underline">Privacy</a>
  </p>
</div>
</body>
</html>`;
}
