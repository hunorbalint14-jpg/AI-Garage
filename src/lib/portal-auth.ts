import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Shared auth + tenant + customer resolution for the logged-in customer portal
// (/dashboard and the pages hanging off it). This is the block that was
// copy-pasted across portal pages: authenticate, resolve the tenant from the
// x-tenant-slug header (injected by src/proxy.ts), then match the customer by
// email within the location, lazily back-filling customers.user_id on first
// sign-in.
//
// Reads happen via the admin client (service role, bypasses RLS), so any row
// addressed by an id from the URL MUST be ownership-checked before it is
// exposed — use the require* helpers below, which 404 on a miss rather than
// leaking the existence of another customer's / tenant's row.

export type PortalOrganization = {
  id: string;
  name: string;
  primary_color: string;
  logo_url: string | null;
  phone: string | null;
};

export type PortalLocation = {
  id: string;
  name: string;
  organization: PortalOrganization;
};

export type PortalCustomer = {
  id: string;
  full_name: string | null;
  user_id: string | null;
  email: string | null;
};

export type PortalContext = {
  user: User;
  location: PortalLocation;
  // Null when the authenticated user has no matching customer row at this
  // tenant — callers decide whether that's a soft state (dashboard shows a
  // "no account found" panel) or a hard notFound() (id-addressed pages).
  customer: PortalCustomer | null;
};

export async function getPortalContext(): Promise<PortalContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const headersList = await headers();
  const slug = headersList.get("x-tenant-slug");
  if (!slug) redirect("/");

  const admin = createAdminClient();

  const { data: location } = (await admin
    .from("locations")
    .select("id, name, organization:organizations(id, name, primary_color, logo_url, phone)")
    .eq("slug", slug)
    .maybeSingle()) as { data: PortalLocation | null };
  if (!location?.organization) redirect("/");

  const { data: customerRow } = await admin
    .from("customers")
    .select("id, full_name, user_id, email")
    .eq("location_id", location.id)
    .eq("email", user.email ?? "")
    .maybeSingle();

  const customer = (customerRow ?? null) as PortalCustomer | null;

  if (customer && !customer.user_id) {
    await admin.from("customers").update({ user_id: user.id }).eq("id", customer.id);
    customer.user_id = user.id;
  }

  return { user, location, customer };
}

export type PortalInvoice = {
  id: string;
  invoice_number: string;
  status: string;
  subtotal: number;
  vat_rate: number;
  vat_amount: number;
  total: number;
  issued_at: string;
  due_at: string;
  paid_at: string | null;
  notes: string | null;
  customer_id: string;
  job_id: string | null;
};

// Fetch an invoice and assert it belongs to this customer at this location.
// notFound() (404) on any miss — wrong owner, wrong tenant, or absent — so we
// never confirm the existence of a row the caller doesn't own.
export async function requireOwnedInvoice(
  customerId: string,
  locationId: string,
  invoiceId: string,
): Promise<PortalInvoice> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("invoices")
    .select(
      "id, invoice_number, status, subtotal, vat_rate, vat_amount, total, issued_at, due_at, paid_at, notes, customer_id, job_id, location_id",
    )
    .eq("id", invoiceId)
    .maybeSingle();

  const invoice = data as (PortalInvoice & { location_id: string }) | null;
  if (!invoice || invoice.customer_id !== customerId || invoice.location_id !== locationId) {
    notFound();
  }
  return invoice;
}

export type PortalJob = {
  id: string;
  status: string;
  description: string | null;
  notes: string | null;
  completed_at: string | null;
  created_at: string | null;
  customer_id: string | null;
  vehicle_id: string | null;
  location_id: string;
};

// Fetch a job and assert it belongs to this customer at this location.
// notFound() (404) on any miss — same non-leaking rule as requireOwnedInvoice.
export async function requireOwnedJob(
  customerId: string,
  locationId: string,
  jobId: string,
): Promise<PortalJob> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("jobs")
    .select("id, status, description, notes, completed_at, created_at, customer_id, vehicle_id, location_id")
    .eq("id", jobId)
    .maybeSingle();

  const job = data as PortalJob | null;
  if (!job || job.customer_id !== customerId || job.location_id !== locationId) {
    notFound();
  }
  return job;
}
