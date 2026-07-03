import Link from "next/link";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { cachedActiveProducts } from "@/lib/location-cache";
import { QuoteBuilder } from "./quote-builder";

export const dynamic = "force-dynamic";

export default async function NewQuotePage() {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  // Products + org default validity in parallel. Customers/vehicles come from
  // the typeahead picker on demand.
  const [cachedProducts, orgRes] = await Promise.all([
    cachedActiveProducts(ctx.location.id),
    admin
      .from("organizations")
      .select("quote_validity_days")
      .eq("id", ctx.organization.id)
      .maybeSingle(),
  ]);

  const products = cachedProducts.map((p) => ({
    id: p.id,
    name: p.name,
    unit_price: p.unit_price,
    category: p.category ?? "",
  }));
  const validityDays = Number((orgRes.data as { quote_validity_days?: number } | null)?.quote_validity_days ?? 30);

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div>
        <Link href="/staff/quotes" className="text-sm text-muted-foreground underline">← Back to quotes</Link>
      </div>
      <div>
        <h1 className="text-2xl font-bold">New quote</h1>
        <p className="text-sm text-muted-foreground mt-1">Draft a quote for a prospect or existing customer. Default validity: {validityDays} days (configurable in settings).</p>
      </div>

      <QuoteBuilder
        products={products}
        defaultValidityDays={validityDays}
      />
    </div>
  );
}
