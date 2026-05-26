import Link from "next/link";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { QuoteBuilder } from "./quote-builder";

export const dynamic = "force-dynamic";

export default async function NewQuotePage() {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  // Load customers + vehicles + products + org default validity in parallel.
  const [customersRes, vehiclesRes, productsRes, orgRes] = await Promise.all([
    admin
      .from("customers")
      .select("id, full_name, email, phone")
      .eq("location_id", ctx.location.id)
      .order("full_name", { ascending: true })
      .limit(500),
    admin
      .from("vehicles")
      .select("id, customer_id, registration, make, model, year")
      .eq("location_id", ctx.location.id)
      .limit(2000),
    admin
      .from("products")
      .select("id, name, unit_price, category")
      .eq("location_id", ctx.location.id)
      .eq("active", true)
      .order("name"),
    admin
      .from("organizations")
      .select("quote_validity_days")
      .eq("id", ctx.organization.id)
      .maybeSingle(),
  ]);

  type Customer = { id: string; full_name: string | null; email: string | null; phone: string | null };
  type Vehicle = { id: string; customer_id: string; registration: string; make: string | null; model: string | null; year: number | null };
  type Product = { id: string; name: string; unit_price: number; category: string };

  const customers = (customersRes.data ?? []) as Customer[];
  const vehicles = (vehiclesRes.data ?? []) as Vehicle[];
  const products = (productsRes.data ?? []) as Product[];
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
        customers={customers}
        vehicles={vehicles}
        products={products}
        defaultValidityDays={validityDays}
      />
    </div>
  );
}
