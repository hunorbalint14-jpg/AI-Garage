import { createAdminClient } from "@/lib/supabase/admin";

// "Books health" (#501): the anti-silent-drift panel. Counts what SHOULD
// be in the ledger but isn't, plus recent failures from the sync log.
// Windowed to records created after the connection was made — history
// from before the org connected was never promised to sync.

export type SyncFailureRow = {
  id: string;
  entityType: string;
  entityId: string | null;
  error: string | null;
  createdAt: string;
};

export type BooksHealth = {
  unsyncedInvoices: number;
  unsyncedPayments: number;
  unsyncedCreditNotes: number;
  failures30d: number;
  recentFailures: SyncFailureRow[];
  /** Sum of invoice totals paid in the last 30 days (our ledger), GBP. */
  paidTotal30d: number;
  /** Same window, only invoices whose payment reached the provider, GBP. */
  syncedPaidTotal30d: number;
};

const PAID_STATUSES = ["paid", "part_refunded", "refunded"];

export async function getBooksHealth(
  orgId: string,
  connectedAt: string,
): Promise<BooksHealth> {
  const admin = createAdminClient();
  const cutoff30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [invoicesRes, paymentsRes, creditNotesRes, failuresRes, paidRowsRes] =
    await Promise.all([
      admin
        .from("invoices")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .is("accounting_invoice_id", null)
        .not("is_demo", "is", true)
        .gte("issued_at", connectedAt),
      admin
        .from("invoices")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .is("accounting_payment_id", null)
        .in("status", PAID_STATUSES)
        .not("is_demo", "is", true)
        .gte("issued_at", connectedAt),
      admin
        .from("credit_notes")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .is("accounting_credit_note_id", null)
        .gte("created_at", connectedAt),
      admin
        .from("accounting_sync_log")
        .select("id, entity_type, entity_id, error, created_at", { count: "exact" })
        .eq("organization_id", orgId)
        .eq("status", "failed")
        .gte("created_at", cutoff30d)
        .order("created_at", { ascending: false })
        .limit(10),
      admin
        .from("invoices")
        .select("total, accounting_payment_id")
        .eq("organization_id", orgId)
        .in("status", PAID_STATUSES)
        .not("is_demo", "is", true)
        .gte("paid_at", cutoff30d)
        .limit(1000),
    ]);

  let paidTotal30d = 0;
  let syncedPaidTotal30d = 0;
  for (const row of (paidRowsRes.data ?? []) as { total: number; accounting_payment_id: string | null }[]) {
    const total = Number(row.total) || 0;
    paidTotal30d += total;
    if (row.accounting_payment_id) syncedPaidTotal30d += total;
  }

  return {
    unsyncedInvoices: invoicesRes.count ?? 0,
    unsyncedPayments: paymentsRes.count ?? 0,
    unsyncedCreditNotes: creditNotesRes.count ?? 0,
    failures30d: failuresRes.count ?? 0,
    recentFailures: ((failuresRes.data ?? []) as {
      id: string;
      entity_type: string;
      entity_id: string | null;
      error: string | null;
      created_at: string;
    }[]).map((r) => ({
      id: r.id,
      entityType: r.entity_type,
      entityId: r.entity_id,
      error: r.error,
      createdAt: r.created_at,
    })),
    paidTotal30d,
    syncedPaidTotal30d,
  };
}
