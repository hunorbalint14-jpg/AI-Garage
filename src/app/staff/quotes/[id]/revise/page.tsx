import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { ReviseForm } from "./revise-form";

export const dynamic = "force-dynamic";

type PersonRef = { full_name: string | null; email: string | null; phone: string | null } | null;

type QuoteRow = {
  id: string;
  quote_type: "job" | "standalone";
  location_id: string;
  status: string;
  title: string | null;
  description: string | null;
  customer_message: string | null;
  revision_number: number;
  customer: PersonRef;
  job: { customer: PersonRef } | null;
};

export default async function ReviseQuotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  const { data } = await admin
    .from("quotes")
    .select(
      "id, quote_type, location_id, status, title, description, customer_message, revision_number, customer:customers(full_name, email, phone), job:jobs(customer:customers(full_name, email, phone))",
    )
    .eq("id", id)
    .maybeSingle();
  const quote = data as unknown as QuoteRow | null;
  if (!quote || quote.location_id !== ctx.location.id) notFound();
  if (quote.status !== "pending" && quote.status !== "expired") {
    redirect(`/staff/quotes/${id}`);
  }

  const { data: itemRows } = await admin
    .from("quote_items")
    .select("description, type, quantity, unit_price, product_id")
    .eq("quote_id", id)
    .order("sort_order");
  const items = (itemRows ?? []) as {
    description: string;
    type: "part" | "labour" | "other";
    quantity: number;
    unit_price: number;
    product_id: string | null;
  }[];

  const customer = quote.quote_type === "job" ? quote.job?.customer ?? null : quote.customer;

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div className="text-sm">
        <Link href={`/staff/quotes/${id}`} className="text-muted-foreground underline">
          ← Back to quote
        </Link>
      </div>
      <div>
        <h1 className="text-2xl font-bold">Revise &amp; re-send</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Editing creates revision {quote.revision_number + 1}. The customer&apos;s current link stops
          working and a new one is sent with your note explaining what changed.
        </p>
      </div>
      <ReviseForm
        quoteId={quote.id}
        initialTitle={quote.title ?? ""}
        initialDescription={quote.description ?? ""}
        initialCustomerMessage={quote.customer_message ?? ""}
        initialItems={items}
        customerName={customer?.full_name ?? null}
        hasEmail={!!customer?.email}
        hasPhone={!!customer?.phone}
      />
    </div>
  );
}
