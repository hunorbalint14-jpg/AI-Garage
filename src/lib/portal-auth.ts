import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
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
  slug: string;
  name: string;
  organization: PortalOrganization;
};

export type PortalOrg = {
  id: string;
  slug: string;
  name: string;
};

export type PortalCustomer = {
  id: string;
  full_name: string | null;
  user_id: string | null;
  email: string | null;
  // The customer's home branch name (customers.preferred_location_id → name).
  home_garage: string | null;
};

export type PortalContext = {
  // Local-verified JWT claims (id + email), not a full Auth-server user object —
  // no network round-trip. The middleware already validates the session
  // (signature + 12h absolute timeout), mirroring staff-context.
  user: { id: string; email: string | undefined };
  organization: PortalOrg;
  // Back-compat: the org's primary location (the subdomain resolves to the org
  // now). Branding lives on `location.organization` / `organization`.
  location: PortalLocation;
  // True when the org has more than one branch — gate branch / home-garage UI.
  multiLocation: boolean;
  // Null when the authenticated user has no matching customer row at this
  // tenant — callers decide whether that's a soft state (dashboard shows a
  // "no account found" panel) or a hard notFound() (id-addressed pages).
  customer: PortalCustomer | null;
};

export async function getPortalContext(): Promise<PortalContext> {
  const supabase = await createClient();
  // Local JWT (JWKS) verification — no Auth network round-trip per page render.
  // Project signs with ES256 (asymmetric), so getClaims verifies offline.
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  if (!claims?.sub) redirect("/login");
  const user = { id: claims.sub as string, email: (claims.email as string | undefined) ?? undefined };

  const headersList = await headers();
  const slug = headersList.get("x-tenant-slug");
  if (!slug) redirect("/");

  const admin = createAdminClient();

  // The subdomain resolves to the ORGANISATION; the customer is registered once
  // per org. Resolve the org (+ its primary location for back-compat branding).
  const { data: org } = (await admin
    .from("organizations")
    .select(
      "id, slug, name, primary_color, logo_url, phone, primary_location_id, locations:locations!organization_id(id, slug, name)",
    )
    .eq("slug", slug)
    .maybeSingle()) as {
    data:
      | (PortalOrganization & {
          slug: string;
          primary_location_id: string | null;
          locations: { id: string; slug: string; name: string }[] | null;
        })
      | null;
  };
  if (!org || !org.locations || org.locations.length === 0) redirect("/");

  const primary =
    org.locations.find((l) => l.id === org.primary_location_id) ??
    org.locations.slice().sort((a, b) => a.name.localeCompare(b.name))[0];
  const organization: PortalOrg = { id: org.id, slug: org.slug, name: org.name };
  const location: PortalLocation = {
    id: primary.id,
    slug: primary.slug,
    name: primary.name,
    organization: { id: org.id, name: org.name, primary_color: org.primary_color, logo_url: org.logo_url, phone: org.phone },
  };

  const { data: customerRow } = await admin
    .from("customers")
    .select("id, full_name, user_id, email, preferred_location:locations(name)")
    .eq("organization_id", org.id)
    .eq("email", user.email ?? "")
    .maybeSingle();

  const customer: PortalCustomer | null = customerRow
    ? {
        id: customerRow.id as string,
        full_name: (customerRow.full_name as string | null) ?? null,
        user_id: (customerRow.user_id as string | null) ?? null,
        email: (customerRow.email as string | null) ?? null,
        home_garage:
          (customerRow as unknown as { preferred_location?: { name: string | null } | null }).preferred_location?.name ?? null,
      }
    : null;

  if (customer && !customer.user_id) {
    await admin.from("customers").update({ user_id: user.id }).eq("id", customer.id);
    customer.user_id = user.id;
  }

  return { user, organization, location, multiLocation: org.locations.length > 1, customer };
}

export type PortalInvoice = {
  id: string;
  invoice_number: string;
  status: string;
  subtotal: number;
  vat_rate: number;
  vat_amount: number;
  total: number;
  discount_amount: number;
  discount_description: string | null;
  membership_credit_amount: number;
  membership_credit_description: string | null;
  issued_at: string;
  due_at: string;
  paid_at: string | null;
  notes: string | null;
  customer_id: string;
  job_id: string | null;
  location_id: string;
};

// Fetch an invoice and assert it belongs to this customer. The customer is
// resolved per-org (getPortalContext matches organization_id + email) and a
// customer belongs to exactly one org, so a customer_id match alone proves
// ownership across every branch. notFound() (404) on any miss — wrong owner or
// absent — so we never confirm the existence of a row the caller doesn't own.
export async function requireOwnedInvoice(
  customerId: string,
  invoiceId: string,
): Promise<PortalInvoice> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("invoices")
    .select(
      "id, invoice_number, status, subtotal, vat_rate, vat_amount, total, discount_amount, discount_description, membership_credit_amount, membership_credit_description, issued_at, due_at, paid_at, notes, customer_id, job_id, location_id",
    )
    .eq("id", invoiceId)
    .maybeSingle();

  const invoice = data as PortalInvoice | null;
  if (!invoice || invoice.customer_id !== customerId) {
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

// Fetch a job and assert it belongs to this customer. notFound() (404) on any
// miss — same customer-scoped, non-leaking rule as requireOwnedInvoice.
export async function requireOwnedJob(
  customerId: string,
  jobId: string,
): Promise<PortalJob> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("jobs")
    .select("id, status, description, notes, completed_at, created_at, customer_id, vehicle_id, location_id")
    .eq("id", jobId)
    .maybeSingle();

  const job = data as PortalJob | null;
  if (!job || job.customer_id !== customerId) {
    notFound();
  }
  return job;
}

export type PortalQuote = {
  id: string;
  source: "job" | "standalone";
  job_id: string | null;
  location_id: string;
  customer_id: string;
  status: string;
};

// Resolve a unified quote by id and assert this customer owns it. Job quotes
// are owned via their parent job's customer; standalone quotes carry
// customer_id directly. Ownership is customer-scoped, not branch-scoped — a
// customer belongs to exactly one org. notFound() (404) on any miss — never
// leak another customer's quote.
export async function requireOwnedQuote(
  customerId: string,
  quoteId: string,
): Promise<PortalQuote> {
  const admin = createAdminClient();

  const { data } = await admin
    .from("quotes")
    .select("id, quote_type, job_id, location_id, customer_id, status, job:jobs(customer_id, location_id)")
    .eq("id", quoteId)
    .maybeSingle();
  if (!data) notFound();

  // PostgREST types the to-one `job` embed as an array — cast through unknown.
  const row = data as unknown as {
    id: string;
    quote_type: "job" | "standalone";
    job_id: string | null;
    location_id: string;
    customer_id: string | null;
    status: string;
    job: { customer_id: string | null; location_id: string } | null;
  };

  const ownerId = row.quote_type === "job" ? row.job?.customer_id : row.customer_id;
  if (ownerId !== customerId) notFound();

  return {
    id: row.id,
    source: row.quote_type,
    job_id: row.job_id,
    location_id: row.location_id,
    customer_id: customerId,
    status: row.status,
  };
}
