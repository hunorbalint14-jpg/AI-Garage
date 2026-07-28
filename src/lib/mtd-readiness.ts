import { createAdminClient } from "@/lib/supabase/admin";
import { getConnectionStatus } from "@/lib/accounting/connection";
import { getBooksHealth } from "@/lib/accounting/health";
import { PROVIDER_LABELS } from "@/lib/accounting/types";
import { isLikelyUkVatNumber } from "@/lib/vat";

// Per-org MTD readiness checklist (docs/mtd-readiness.md WS4). Derived,
// never stored — same pattern as the activation checklist. "Ready" here
// means: the org's sales record flows into HMRC-recognised software over
// a digital link, with the VAT designatory data complete. It does NOT
// mean AI Garage is HMRC-recognised software — never claim that.

export type MtdCheckStatus = "ok" | "warn" | "todo";

export type MtdCheck = {
  key: string;
  label: string;
  status: MtdCheckStatus;
  detail: string;
};

export type MtdReadiness = {
  checks: MtdCheck[];
  ready: boolean;
};

export async function getMtdReadiness(orgId: string): Promise<MtdReadiness> {
  const admin = createAdminClient();

  const [{ data: orgData }, connection] = await Promise.all([
    admin
      .from("organizations")
      .select("vat_registered, vat_number, business_structure")
      .eq("id", orgId)
      .maybeSingle(),
    getConnectionStatus(orgId),
  ]);
  const org = orgData as {
    vat_registered: boolean | null;
    vat_number: string | null;
    business_structure: string | null;
  } | null;

  const checks: MtdCheck[] = [];

  // 1. VAT designatory data — the electronic account must carry the VRN.
  const vatRegistered = org?.vat_registered !== false;
  if (!vatRegistered) {
    checks.push({
      key: "vat",
      label: "VAT registration",
      status: "ok",
      detail: "Marked not VAT-registered — MTD for VAT doesn't apply. Update Settings → Payments & Quotes if that changes.",
    });
  } else if (!org?.vat_number) {
    checks.push({
      key: "vat",
      label: "VAT registration",
      status: "todo",
      detail: "VAT-registered but no VAT number saved — it's legally required on VAT invoices. Add it in Settings → Payments & Quotes.",
    });
  } else if (!isLikelyUkVatNumber(org.vat_number)) {
    checks.push({
      key: "vat",
      label: "VAT registration",
      status: "warn",
      detail: `Saved VAT number "${org.vat_number}" doesn't look like a UK VRN (e.g. GB123456789) — check it.`,
    });
  } else {
    checks.push({
      key: "vat",
      label: "VAT registration",
      status: "ok",
      detail: `VAT number ${org.vat_number} prints on every invoice.`,
    });
  }

  // 2 + 3. The digital link itself, and whether it is up to date.
  if (!connection) {
    checks.push({
      key: "link",
      label: "Digital link to accounting software",
      status: "warn",
      detail:
        "No accounting connection. Connect Xero, QuickBooks or Sage — or use the sales CSV export (also a valid MTD digital link). Re-typing invoices into other software is not MTD-compliant.",
    });
  } else if (connection.needsReconnect) {
    checks.push({
      key: "link",
      label: "Digital link to accounting software",
      status: "todo",
      detail: `${PROVIDER_LABELS[connection.provider]} sync has stopped — the saved authorisation expired. Reconnect in Settings → Integrations.`,
    });
  } else {
    checks.push({
      key: "link",
      label: "Digital link to accounting software",
      status: "ok",
      detail: `Sales sync to ${PROVIDER_LABELS[connection.provider]} is connected — invoices, payments and refunds flow without re-keying.`,
    });

    const health = await getBooksHealth(orgId, connection.connectedAt);
    const unsynced = health.unsyncedInvoices + health.unsyncedPayments + health.unsyncedCreditNotes;
    checks.push({
      key: "synced",
      label: "Everything synced",
      status: unsynced === 0 ? "ok" : "warn",
      detail:
        unsynced === 0
          ? "No unsynced invoices, payments or refunds in the window."
          : `${unsynced} record${unsynced === 1 ? "" : "s"} not yet in ${PROVIDER_LABELS[connection.provider]} — the nightly sweep retries automatically, or use "Retry sync now".`,
    });
  }

  // 4. MOT services carry the right treatment (Box 6 correctness).
  const { data: locs } = await admin.from("locations").select("id").eq("organization_id", orgId);
  const locIds = ((locs ?? []) as { id: string }[]).map((l) => l.id);
  if (locIds.length > 0 && vatRegistered) {
    const { count: badMot } = await admin
      .from("services")
      .select("id", { count: "exact", head: true })
      .in("location_id", locIds)
      .ilike("name", "%mot%")
      .neq("vat_treatment", "outside_scope");
    checks.push({
      key: "mot",
      label: "MOT VAT treatment",
      status: (badMot ?? 0) === 0 ? "ok" : "warn",
      detail:
        (badMot ?? 0) === 0
          ? "MOT services are outside the scope of VAT, as HMRC expects."
          : `${badMot} MOT-named service${badMot === 1 ? "" : "s"} not marked outside-scope — check Settings → Services (statutory MOT fees carry no VAT).`,
    });
  }

  // 5. Business structure — routes MTD for Income Tax guidance.
  checks.push({
    key: "structure",
    label: "Business structure recorded",
    status: org?.business_structure ? "ok" : "todo",
    detail: org?.business_structure
      ? org.business_structure === "sole_trader"
        ? "Sole trader — MTD for Income Tax applies above the income threshold; quarterly updates run through your accounting software or accountant."
        : "Recorded — MTD for Income Tax doesn't apply to this structure (VAT rules still do)."
      : "Set it in Settings → Payments & Quotes so tax guidance (MTD for Income Tax applies to sole traders) is accurate.",
  });

  return { checks, ready: checks.every((c) => c.status === "ok") };
}
