"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { verifyCheckAccess } from "@/lib/inspection-links";
import { decrypt } from "@/lib/encryption";
import { logAudit } from "@/lib/audit";
import { approveQuote, declineQuote } from "@/app/quote/[slug]/actions";

// eVHC report response (#497 Phase 5). The customer authorises with the
// REPORT token; the linked quote's raw token is recovered server-side from
// link_token_encrypted and the EXISTING quote approve/decline actions do all
// the heavy lifting (partial approval, deposits, approved_after_close,
// decline reasons, staff notifications). This file only maps between the two
// and writes per-finding outcomes back onto inspection_items.

export type CheckRespondResult =
  | { error: string }
  | { success: true; approved: boolean; depositUrl?: string };

type QuoteRow = {
  id: string;
  slug: string | null;
  status: string;
  link_token_encrypted: string | null;
};

async function loadCheckQuote(
  slug: string,
  token: string,
): Promise<{ error: string } | { inspectionId: string; orgId: string | null; quote: QuoteRow; quoteToken: string }> {
  const verify = await verifyCheckAccess(slug, token, ["sent"]);
  if (!verify.ok) return { error: "Invalid link. Contact the garage for a new one." };
  if (!verify.inspection.quote_id) return { error: "There's nothing to approve on this report." };

  const admin = createAdminClient();
  const [{ data: q }, { data: loc }] = await Promise.all([
    admin
      .from("quotes")
      .select("id, slug, status, link_token_encrypted")
      .eq("id", verify.inspection.quote_id)
      .maybeSingle(),
    admin.from("locations").select("organization_id").eq("id", verify.inspection.location_id).maybeSingle(),
  ]);
  const quote = q as QuoteRow | null;
  if (!quote?.slug) return { error: "The quote for this report is no longer available." };
  if (quote.status !== "pending") return { error: "This quote has already been responded to." };
  if (!quote.link_token_encrypted) return { error: "The quote link can't be recovered — contact the garage." };

  let quoteToken: string;
  try {
    quoteToken = decrypt(quote.link_token_encrypted);
  } catch {
    return { error: "The quote link can't be recovered — contact the garage." };
  }

  return {
    inspectionId: verify.inspection.id,
    orgId: (loc as { organization_id: string | null } | null)?.organization_id ?? null,
    quote,
    quoteToken,
  };
}

// Map quote_item ids → inspection_item outcomes after a response. Approved
// set → 'approved'; every other finding on the quote → 'declined'.
async function writeOutcomes(quoteId: string, approvedQuoteItemIds: string[]): Promise<void> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("quote_items")
    .select("id, inspection_item_id")
    .eq("quote_id", quoteId)
    .not("inspection_item_id", "is", null);
  const rows = ((data ?? []) as { id: string; inspection_item_id: string }[]);
  const approved = rows.filter((r) => approvedQuoteItemIds.includes(r.id)).map((r) => r.inspection_item_id);
  const declined = rows.filter((r) => !approvedQuoteItemIds.includes(r.id)).map((r) => r.inspection_item_id);
  if (approved.length > 0) {
    await admin.from("inspection_items").update({ outcome: "approved" }).in("id", approved);
  }
  if (declined.length > 0) {
    await admin.from("inspection_items").update({ outcome: "declined" }).in("id", declined);
  }
}

export async function respondToCheck(
  slug: string,
  token: string,
  response: { approvedQuoteItemIds: string[] } | { declineReason: string | null },
): Promise<CheckRespondResult> {
  const loaded = await loadCheckQuote(slug, token);
  if ("error" in loaded) return loaded;
  const { inspectionId, orgId, quote, quoteToken } = loaded;

  const approving = "approvedQuoteItemIds" in response && response.approvedQuoteItemIds.length > 0;

  if (approving) {
    const ids = (response as { approvedQuoteItemIds: string[] }).approvedQuoteItemIds;
    const result = await approveQuote(quote.slug!, quoteToken, ids);
    if ("error" in result) return result;
    await writeOutcomes(quote.id, ids);
    await logAudit({
      organizationId: orgId,
      action: "inspection.respond",
      entityType: "inspection",
      entityId: inspectionId,
      metadata: { decision: "approved", quote_id: quote.id, approved_count: ids.length },
    });
    return { success: true, approved: true, depositUrl: result.depositUrl };
  }

  const reason = "declineReason" in response ? response.declineReason : null;
  const result = await declineQuote(quote.slug!, quoteToken, reason);
  if ("error" in result) return result;
  await writeOutcomes(quote.id, []);
  await logAudit({
    organizationId: orgId,
    action: "inspection.respond",
    entityType: "inspection",
    entityId: inspectionId,
    metadata: { decision: "declined", quote_id: quote.id, reason },
  });
  return { success: true, approved: false };
}
