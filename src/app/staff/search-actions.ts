"use server";

import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";

export type SearchHit = {
  /** Route to navigate to on selection. */
  href: string;
  /** Primary line, e.g. customer name or invoice number. */
  title: string;
  /** Secondary line, e.g. phone / reg / status. */
  subtitle: string | null;
  /** Monospace badge, e.g. a registration. */
  badge: string | null;
};

export type SearchResults = {
  customers: SearchHit[];
  vehicles: SearchHit[];
  invoices: SearchHit[];
};

const EMPTY: SearchResults = { customers: [], vehicles: [], invoices: [] };
const GROUP_LIMIT = 5;

// Global staff search behind the Cmd+K palette. All queries scoped to the
// current location; service-role client is fine because requireStaffContext
// has already authenticated the member.
export async function globalSearch(rawQuery: string): Promise<SearchResults> {
  const q = rawQuery.trim();
  if (q.length < 2) return EMPTY;
  const ctx = await requireStaffContext();
  const admin = createAdminClient();
  const like = `%${q}%`;

  const [custRes, vehRes, invRes] = await Promise.all([
    admin
      .from("customers")
      .select("id, full_name, phone, email")
      .eq("location_id", ctx.location.id)
      .or(`full_name.ilike.${like},phone.ilike.${like},email.ilike.${like}`)
      .order("full_name", { ascending: true })
      .limit(GROUP_LIMIT),
    admin
      .from("vehicles")
      .select("registration, make, model, customer:customers(id, full_name)")
      .eq("location_id", ctx.location.id)
      .ilike("registration", like)
      .limit(GROUP_LIMIT),
    admin
      .from("invoices")
      .select("id, invoice_number, status, total, customer:customers(full_name)")
      .eq("location_id", ctx.location.id)
      .ilike("invoice_number", like)
      .order("issued_at", { ascending: false })
      .limit(GROUP_LIMIT),
  ]);

  type Cust = { id: string; full_name: string | null; phone: string | null; email: string | null };
  type Veh = {
    registration: string;
    make: string | null;
    model: string | null;
    customer: { id: string; full_name: string | null } | null;
  };
  type Inv = {
    id: string;
    invoice_number: string;
    status: string;
    total: number;
    customer: { full_name: string | null } | null;
  };

  const customers = ((custRes.data ?? []) as Cust[]).map((c) => ({
    href: `/staff/customers/${c.id}`,
    title: c.full_name ?? "(no name)",
    subtitle: [c.phone, c.email].filter(Boolean).join(" · ") || null,
    badge: null,
  }));

  const vehicles = ((vehRes.data ?? []) as unknown as Veh[])
    .filter((v) => v.customer)
    .map((v) => ({
      href: `/staff/customers/${v.customer!.id}`,
      title: v.customer!.full_name ?? "(no name)",
      subtitle: [v.make, v.model].filter(Boolean).join(" ") || null,
      badge: v.registration,
    }));

  const invoices = ((invRes.data ?? []) as unknown as Inv[]).map((i) => ({
    href: `/staff/invoices/${i.id}`,
    title: i.invoice_number,
    subtitle: [i.customer?.full_name, i.status, `£${Number(i.total).toFixed(2)}`]
      .filter(Boolean)
      .join(" · "),
    badge: null,
  }));

  return { customers, vehicles, invoices };
}
