import { createAdminClient } from "@/lib/supabase/admin";

// Account-customer helpers (#504 PR 2): balance and credit checks. Balance =
// open invoiced £ (total − amount_paid on 'sent' invoices) + unbilled
// completed-job £ for consolidated accounts (work done on tick, not yet
// rolled into a month-end invoice).

type Admin = ReturnType<typeof createAdminClient>;

export type AccountProfile = {
  accountCustomer: boolean;
  paymentTermsDays: number;
  creditLimit: number | null;
  consolidatedBilling: boolean;
};

export type AccountBalance = {
  openInvoiced: number;
  unbilledJobs: number;
  unbilledJobCount: number;
  total: number;
};

export type CreditCheck =
  | { state: "ok" }
  | { state: "warn" | "block"; balance: number; limit: number };

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function accountProfile(admin: Admin, customerId: string): Promise<AccountProfile | null> {
  const { data } = await admin
    .from("customers")
    .select("account_customer, payment_terms_days, credit_limit, consolidated_billing")
    .eq("id", customerId)
    .maybeSingle();
  const row = data as {
    account_customer: boolean;
    payment_terms_days: number;
    credit_limit: number | null;
    consolidated_billing: boolean;
  } | null;
  if (!row) return null;
  return {
    accountCustomer: row.account_customer,
    paymentTermsDays: Number(row.payment_terms_days ?? 30),
    creditLimit: row.credit_limit !== null ? Number(row.credit_limit) : null,
    consolidatedBilling: row.consolidated_billing,
  };
}

export async function accountBalance(admin: Admin, customerId: string): Promise<AccountBalance> {
  const [{ data: openInv }, { data: unbilled }] = await Promise.all([
    admin
      .from("invoices")
      .select("total, amount_paid")
      .eq("customer_id", customerId)
      .eq("status", "sent"),
    // Completed jobs never invoiced individually NOR via a consolidated run.
    // NB: jobs→invoices now has TWO paths (invoices.job_id + the invoice_jobs
    // join table) — the embed MUST be hinted or PostgREST 201-errors.
    admin
      .from("jobs")
      .select("id, items:job_items(quantity, unit_price, vat_rate), invoices!invoices_job_id_fkey(id), invoice_jobs(id)")
      .eq("customer_id", customerId)
      .eq("status", "complete"),
  ]);

  const openInvoiced = r2(
    ((openInv ?? []) as { total: number; amount_paid: number }[]).reduce(
      (s, i) => s + Math.max(0, Number(i.total) - Number(i.amount_paid ?? 0)),
      0,
    ),
  );

  type UnbilledRow = {
    id: string;
    items: { quantity: number; unit_price: number; vat_rate: number | null }[] | null;
    invoices: { id: string }[] | null;
    invoice_jobs: { id: string }[] | null;
  };
  let unbilledJobs = 0;
  let unbilledJobCount = 0;
  for (const j of ((unbilled ?? []) as unknown as UnbilledRow[])) {
    if ((j.invoices ?? []).length > 0 || (j.invoice_jobs ?? []).length > 0) continue;
    const total = (j.items ?? []).reduce(
      (s, it) => s + it.quantity * it.unit_price * (1 + (Number(it.vat_rate) || 0) / 100),
      0,
    );
    unbilledJobs = r2(unbilledJobs + total);
    unbilledJobCount += 1;
  }

  return { openInvoiced, unbilledJobs, unbilledJobCount, total: r2(openInvoiced + unbilledJobs) };
}

// Would `newWorkValue` breach the account's credit limit? Non-account
// customers and unlimited accounts are always ok. Never throws — a credit
// check failure must not break booking/job creation.
export async function checkCredit(
  admin: Admin,
  customerId: string | null,
  organizationId: string,
  newWorkValue = 0,
): Promise<CreditCheck> {
  try {
    if (!customerId) return { state: "ok" };
    const profile = await accountProfile(admin, customerId);
    if (!profile?.accountCustomer || profile.creditLimit === null) return { state: "ok" };

    const balance = await accountBalance(admin, customerId);
    if (balance.total + newWorkValue <= profile.creditLimit) return { state: "ok" };

    const { data: org } = await admin
      .from("organizations")
      .select("credit_control_mode")
      .eq("id", organizationId)
      .maybeSingle();
    const mode = (org as { credit_control_mode: string } | null)?.credit_control_mode === "block" ? "block" : "warn";
    return { state: mode, balance: balance.total, limit: profile.creditLimit };
  } catch (err) {
    console.error("[account] credit check failed", err);
    return { state: "ok" };
  }
}
