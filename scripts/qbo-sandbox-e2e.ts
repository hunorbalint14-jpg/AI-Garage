 
// One-shot QuickBooks sandbox end-to-end drive (#501 follow-up).
// Seeds a connection row with REAL sandbox tokens, then pushes a real
// invoice → payment → credit note through the provider seam and prints
// what landed. Run against the LOCAL stack (local Supabase + demo seed):
//
//   npx tsx scripts/qbo-sandbox-e2e.ts \
//     --realm <sandbox realmId> \
//     --access <access_token> \
//     --refresh <refresh_token>
//
// Get the three values from the Intuit OAuth 2.0 Playground
// (developer.intuit.com → your app → OAuth 2.0 Playground) with scope
// com.intuit.quickbooks.accounting against a UK sandbox company.
// Requires QUICKBOOKS_CLIENT_ID/SECRET in .env.local (used if the access
// token needs a refresh mid-run) and QUICKBOOKS_ENVIRONMENT unset/sandbox.

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || !process.argv[i + 1]) {
    console.error(`Missing --${name}`);
    process.exit(1);
  }
  return process.argv[i + 1];
}

async function main() {
  const realm = arg("realm");
  const access = arg("access");
  const refresh = arg("refresh");

  // Imported AFTER dotenv so APP_ENCRYPTION_KEY is present.
  const { encrypt } = await import("../src/lib/encryption");
  const { pushInvoiceToAccounting, pushPaymentToAccounting, pushCreditNoteToAccounting } =
    await import("../src/lib/accounting/sync");

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const { data: org } = await admin
    .from("organizations")
    .select("id, slug")
    .eq("slug", "smith-motors")
    .single();
  if (!org) throw new Error("demo org missing — run `npm run help:seed` first");

  // Wire the sandbox connection (upsert clears mappings via a fresh
  // external_id only when it differs — force-clear here so the run always
  // creates fresh records on the sandbox side).
  await admin.from("accounting_connections").delete().eq("organization_id", org.id);
  await admin
    .from("invoices")
    .update({ accounting_invoice_id: null, accounting_payment_id: null, accounting_synced_at: null })
    .eq("organization_id", org.id);
  await admin.from("customers").update({ accounting_contact_id: null }).eq("organization_id", org.id);
  await admin.from("credit_notes").update({ accounting_credit_note_id: null }).eq("organization_id", org.id);

  const { error: connErr } = await admin.from("accounting_connections").insert({
    organization_id: org.id,
    provider: "quickbooks",
    external_id: realm,
    display_name: "Sandbox E2E",
    access_token: encrypt(access),
    refresh_token: encrypt(refresh),
    token_expires_at: new Date(Date.now() + 55 * 60 * 1000).toISOString(),
    connected_at: new Date(0).toISOString(), // window covers all seed invoices
  });
  if (connErr) throw new Error(connErr.message);
  console.log(`connection seeded → realm ${realm}`);

  // Pick a paid, non-demo seed invoice with a customer.
  const { data: inv } = await admin
    .from("invoices")
    .select("id, invoice_number, total, status, paid_at, customer_id")
    .eq("organization_id", org.id)
    .eq("status", "paid")
    .not("customer_id", "is", null)
    .not("is_demo", "is", true)
    .order("issued_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!inv) throw new Error("no paid seed invoice found");
  console.log(`driving invoice ${inv.invoice_number} (£${inv.total})`);

  const invoiceExt = await pushInvoiceToAccounting(inv.id as string);
  console.log(`invoice   → ${invoiceExt ?? "FAILED"}`);

  const paymentExt = invoiceExt
    ? await pushPaymentToAccounting({
        invoiceId: inv.id as string,
        amountPence: Math.round(Number(inv.total) * 100),
        paymentDate: (inv.paid_at as string | null) ?? new Date().toISOString(),
        reference: "sandbox-e2e",
      })
    : null;
  console.log(`payment   → ${paymentExt ?? "FAILED"}`);

  const { data: cn } = await admin
    .from("credit_notes")
    .select("id, credit_number, subtotal")
    .eq("organization_id", org.id)
    .not("customer_id", "is", null)
    .limit(1)
    .maybeSingle();
  if (cn) {
    const cnExt = await pushCreditNoteToAccounting(cn.id as string);
    console.log(`credit    → ${cnExt ?? "FAILED"} (${cn.credit_number}, £${cn.subtotal})`);
  } else {
    console.log("credit    → no seed credit note, skipped");
  }

  const { data: log } = await admin
    .from("accounting_sync_log")
    .select("entity_type, status, external_id, error")
    .eq("organization_id", org.id)
    .order("created_at", { ascending: false })
    .limit(8);
  console.log("\nsync log (newest first):");
  for (const row of log ?? []) {
    console.log(`  ${row.status.padEnd(6)} ${row.entity_type.padEnd(11)} ${row.external_id ?? ""} ${row.error ? "— " + row.error.slice(0, 140) : ""}`);
  }

  const failed = (log ?? []).some((r) => r.status === "failed");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
