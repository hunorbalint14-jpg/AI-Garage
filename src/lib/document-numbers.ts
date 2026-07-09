import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

// Allocate the next invoice / credit-note number for a branch: the atomic
// per-location counter (#451 migration) formatted with the branch's
// invoice_prefix — "SMI-INV-0005" / "SMI-CN-0003", or plain "INV-0005" when
// the branch has no prefix.
export async function nextDocumentNumber(
  admin: Admin,
  locationId: string,
  kind: "invoice" | "credit_note",
): Promise<{ number: string } | { error: string }> {
  const [locRes, numRes] = await Promise.all([
    admin.from("locations").select("invoice_prefix").eq("id", locationId).maybeSingle(),
    admin.rpc("next_document_number", { p_location_id: locationId, p_kind: kind }),
  ]);
  if (numRes.error || typeof numRes.data !== "number") {
    return { error: numRes.error?.message ?? "counter returned no value" };
  }
  const rawPrefix = (locRes.data as { invoice_prefix: string | null } | null)?.invoice_prefix;
  const prefix = rawPrefix?.trim() ? `${rawPrefix.trim().toUpperCase()}-` : "";
  const label = kind === "invoice" ? "INV" : "CN";
  return { number: `${prefix}${label}-${String(numRes.data).padStart(4, "0")}` };
}
