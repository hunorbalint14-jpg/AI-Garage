import Link from "next/link";
import { FileText, ChevronRight, AlertCircle } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortalContext } from "@/lib/portal-auth";
import { PortalShell } from "../portal-shell";

type QuoteRow = { id: string; title: string | null; status: string; total: number; created_at: string };
type ListQuote = QuoteRow & { source: "job" | "standalone" };

function fmt(n: number) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
}
function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const STATUS: Record<string, { label: string; style: string }> = {
  pending: { label: "Awaiting your response", style: "bg-amber-500/20 text-amber-400" },
  approved: { label: "Approved", style: "bg-green-500/20 text-green-400" },
  approved_after_close: { label: "Approved", style: "bg-green-500/20 text-green-400" },
  declined: { label: "Declined", style: "bg-red-500/20 text-red-400" },
  rebooked: { label: "Rebooked", style: "bg-blue-500/20 text-blue-400" },
  expired: { label: "Expired", style: "bg-gray-500/20 text-gray-400" },
};

export default async function PortalQuotesPage() {
  const { location, customer } = await getPortalContext();
  const org = location.organization;

  if (!customer) {
    return (
      <PortalShell org={org}>
        <Empty title="No account found" body={`We couldn't find a customer record linked to your email. Please contact ${org.name}.`} />
      </PortalShell>
    );
  }

  const admin = createAdminClient();
  const { data: jobRows } = await admin.from("jobs").select("id").eq("customer_id", customer.id).eq("location_id", location.id);
  const jobIds = (jobRows ?? []).map((r) => (r as { id: string }).id);

  const [jqRes, saRes] = await Promise.all([
    jobIds.length
      ? admin.from("job_quotes").select("id, title, status, total, created_at").in("job_id", jobIds).order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    admin.from("standalone_quotes").select("id, title, status, total, created_at").eq("customer_id", customer.id).eq("location_id", location.id).order("created_at", { ascending: false }),
  ]);

  const quotes: ListQuote[] = [
    ...((jqRes.data ?? []) as QuoteRow[]).map((q) => ({ ...q, source: "job" as const })),
    ...((saRes.data ?? []) as QuoteRow[]).map((q) => ({ ...q, source: "standalone" as const })),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const pending = quotes.filter((q) => q.status === "pending");
  const rest = quotes.filter((q) => q.status !== "pending");

  return (
    <PortalShell org={org}>
      <div>
        <h1 className="text-2xl font-bold">Quotes</h1>
        <p className="mt-1 text-sm text-gray-400">Work {org.name} has quoted you for.</p>
      </div>

      {quotes.length === 0 ? (
        <Empty title="No quotes yet" body="When the garage sends you a quote for additional or upcoming work, it'll appear here." />
      ) : (
        <>
          {pending.length > 0 && (
            <Section title="Awaiting your response">
              {pending.map((q) => (
                <QuoteCard key={`${q.source}-${q.id}`} quote={q} orgColor={org.primary_color} />
              ))}
            </Section>
          )}
          {rest.length > 0 && (
            <Section title="History">
              {rest.map((q) => (
                <QuoteCard key={`${q.source}-${q.id}`} quote={q} orgColor={org.primary_color} />
              ))}
            </Section>
          )}
        </>
      )}
    </PortalShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">{title}</h2>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

function QuoteCard({ quote, orgColor }: { quote: ListQuote; orgColor: string }) {
  const status = STATUS[quote.status] ?? { label: quote.status, style: "bg-gray-500/20 text-gray-400" };
  const isPending = quote.status === "pending";
  return (
    <Link
      href={`/dashboard/quotes/${quote.id}`}
      className={`flex items-center justify-between gap-4 rounded-2xl border p-4 backdrop-blur-sm transition-colors ${
        isPending ? "border-amber-500/30 bg-amber-500/[0.05] hover:bg-amber-500/[0.08]" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
      }`}
    >
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ backgroundColor: `${orgColor}25` }}>
          {isPending ? <AlertCircle className="h-5 w-5 text-amber-400" /> : <FileText className="h-5 w-5" style={{ color: orgColor }} />}
        </div>
        <div>
          <p className="font-semibold">{quote.title || "Quote"}</p>
          <p className="text-xs text-gray-400">{fmtDate(quote.created_at)} · {fmt(quote.total)}</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className={`hidden rounded-full px-2.5 py-0.5 text-xs font-medium sm:inline ${status.style}`}>{status.label}</span>
        <ChevronRight className="h-5 w-5 shrink-0 text-gray-500" />
      </div>
    </Link>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center backdrop-blur-sm">
      <FileText className="mx-auto mb-3 h-8 w-8 text-gray-600" />
      <p className="font-semibold">{title}</p>
      <p className="mt-2 text-sm text-gray-400">{body}</p>
    </div>
  );
}
