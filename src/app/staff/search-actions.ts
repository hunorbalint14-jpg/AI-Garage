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
  jobs: SearchHit[];
  bookings: SearchHit[];
  quotes: SearchHit[];
  invoices: SearchHit[];
};

const EMPTY: SearchResults = {
  customers: [],
  vehicles: [],
  jobs: [],
  bookings: [],
  quotes: [],
  invoices: [],
};
const GROUP_LIMIT = 5;
// Wider net for the id-lookup phase, so "smith" still reaches the job/booking
// groups even when more than GROUP_LIMIT customers match by name.
const ID_LIMIT = 20;

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Global staff search behind the Cmd+K palette. Customers + vehicles are
// org-global; jobs/bookings/quotes/invoices stay scoped to the active branch
// (ops-local). Service-role client is fine because requireStaffContext has
// authenticated the member.
//
// Two phases: (1) match customers/vehicles/invoices directly, then (2) use the
// matched customer/vehicle ids to find the operational records that reference
// them — plus direct field matches (job description, quote title/slug, booking
// notes). DVI quotes are reachable through their parent job's hit.
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
      .eq("organization_id", ctx.organization.id)
      .or(`full_name.ilike.${like},phone.ilike.${like},email.ilike.${like}`)
      .order("full_name", { ascending: true })
      .limit(ID_LIMIT),
    admin
      .from("vehicles")
      .select("id, registration, make, model, customer:customers(id, full_name)")
      .eq("organization_id", ctx.organization.id)
      .ilike("registration", like)
      .limit(ID_LIMIT),
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
    id: string;
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

  const custRows = (custRes.data ?? []) as Cust[];
  const vehRows = (vehRes.data ?? []) as unknown as Veh[];
  const custIds = custRows.map((c) => c.id);
  const vehIds = vehRows.map((v) => v.id);

  // Phase 2: operational records referencing the matched people/vehicles, or
  // matching on their own text fields.
  const refClauses = (extra: string[]) =>
    [
      ...extra,
      custIds.length ? `customer_id.in.(${custIds.join(",")})` : null,
      vehIds.length ? `vehicle_id.in.(${vehIds.join(",")})` : null,
    ]
      .filter(Boolean)
      .join(",");

  const [jobRes, bookRes, quoteRes] = await Promise.all([
    admin
      .from("jobs")
      .select("id, status, description, customer:customers(full_name), vehicle:vehicles(registration)")
      .eq("location_id", ctx.location.id)
      .or(refClauses([`description.ilike.${like}`]))
      .order("created_at", { ascending: false })
      .limit(GROUP_LIMIT),
    admin
      .from("bookings")
      .select("id, scheduled_at, type, status, customer:customers(full_name), vehicle:vehicles(registration)")
      .eq("location_id", ctx.location.id)
      .or(refClauses([`notes.ilike.${like}`]))
      .order("scheduled_at", { ascending: false })
      .limit(GROUP_LIMIT),
    admin
      .from("quotes")
      .select("id, status, title, total, customer:customers(full_name), vehicle:vehicles(registration)")
      .eq("location_id", ctx.location.id)
      .or(refClauses([`title.ilike.${like}`, `slug.ilike.${like}`]))
      .order("created_at", { ascending: false })
      .limit(GROUP_LIMIT),
  ]);

  type Job = {
    id: string;
    status: string;
    description: string | null;
    customer: { full_name: string | null } | null;
    vehicle: { registration: string } | null;
  };
  type Booking = {
    id: string;
    scheduled_at: string;
    type: string;
    status: string;
    customer: { full_name: string | null } | null;
    vehicle: { registration: string } | null;
  };
  type Quote = {
    id: string;
    status: string;
    title: string | null;
    total: number;
    customer: { full_name: string | null } | null;
    vehicle: { registration: string } | null;
  };

  const customers = custRows.slice(0, GROUP_LIMIT).map((c) => ({
    href: `/staff/customers/${c.id}`,
    title: c.full_name ?? "(no name)",
    subtitle: [c.phone, c.email].filter(Boolean).join(" · ") || null,
    badge: null,
  }));

  const vehicles = vehRows
    .filter((v) => v.customer)
    .slice(0, GROUP_LIMIT)
    .map((v) => ({
      href: `/staff/customers/${v.customer!.id}`,
      title: v.customer!.full_name ?? "(no name)",
      subtitle: [v.make, v.model].filter(Boolean).join(" ") || null,
      badge: v.registration,
    }));

  const jobs = ((jobRes.data ?? []) as unknown as Job[]).map((j) => ({
    href: `/staff/jobs/${j.id}`,
    title: j.description || "Untitled job",
    subtitle: [j.customer?.full_name, j.status.replace(/_/g, " ")].filter(Boolean).join(" · ") || null,
    badge: j.vehicle?.registration ?? null,
  }));

  const bookings = ((bookRes.data ?? []) as unknown as Booking[]).map((b) => ({
    href: `/staff/bookings/${b.id}`,
    title: `${b.type === "mot" ? "MOT" : b.type.charAt(0).toUpperCase() + b.type.slice(1)} — ${fmtWhen(b.scheduled_at)}`,
    subtitle: [b.customer?.full_name, b.status.replace(/_/g, " ")].filter(Boolean).join(" · ") || null,
    badge: b.vehicle?.registration ?? null,
  }));

  const quotes = ((quoteRes.data ?? []) as unknown as Quote[]).map((qr) => ({
    href: `/staff/quotes/${qr.id}`,
    title: qr.title || "(no title)",
    subtitle: [qr.customer?.full_name, qr.status.replace(/_/g, " "), `£${Number(qr.total).toFixed(2)}`]
      .filter(Boolean)
      .join(" · "),
    badge: qr.vehicle?.registration ?? null,
  }));

  const invoices = ((invRes.data ?? []) as unknown as Inv[]).map((i) => ({
    href: `/staff/invoices/${i.id}`,
    title: i.invoice_number,
    subtitle: [i.customer?.full_name, i.status, `£${Number(i.total).toFixed(2)}`]
      .filter(Boolean)
      .join(" · "),
    badge: null,
  }));

  return { customers, vehicles, jobs, bookings, quotes, invoices };
}
