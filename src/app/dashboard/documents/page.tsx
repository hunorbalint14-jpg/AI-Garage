import Link from "next/link";
import { Receipt, Video, Wrench, FileCheck, ChevronRight, ExternalLink, FolderOpen } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortalContext } from "@/lib/portal-auth";
import { PortalShell } from "../portal-shell";

type JobRow = {
  id: string;
  status: string;
  description: string | null;
  completed_at: string | null;
  vehicle: { registration: string } | null;
};
type InvoiceRow = { id: string; invoice_number: string; total: number; status: string; issued_at: string | null };
type DviRow = { id: string; title: string | null; created_at: string; job_id: string };
type VehicleRow = { id: string; registration: string; make: string | null; model: string | null; year: number | null };

function fmt(n: number) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
}
function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
function motHistoryUrl(reg: string) {
  return `https://www.check-mot.service.gov.uk/results?registration=${encodeURIComponent(reg)}&checkRecalls=true`;
}

export default async function DocumentsPage() {
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

  const { data: jobRows } = await admin
    .from("jobs")
    .select("id, status, description, completed_at, vehicle:vehicles(registration)")
    .eq("customer_id", customer.id)
    .eq("location_id", location.id)
    .order("completed_at", { ascending: false, nullsFirst: false });
  const jobs = (jobRows ?? []) as unknown as JobRow[];
  const jobIds = jobs.map((j) => j.id);

  const [invoicesRes, dviRes, vehiclesRes] = await Promise.all([
    admin
      .from("invoices")
      .select("id, invoice_number, total, status, issued_at")
      .eq("customer_id", customer.id)
      .eq("location_id", location.id)
      .order("issued_at", { ascending: false, nullsFirst: false }),
    jobIds.length
      ? admin.from("job_quotes").select("id, title, created_at, job_id").in("job_id", jobIds).order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    admin.from("vehicles").select("id, registration, make, model, year").eq("customer_id", customer.id).order("created_at", { ascending: false }),
  ]);

  const invoices = (invoicesRes.data ?? []) as InvoiceRow[];
  const dvis = (dviRes.data ?? []) as DviRow[];
  const vehicles = (vehiclesRes.data ?? []) as VehicleRow[];
  const serviceRecords = jobs.filter((j) => j.status === "complete" || j.status === "invoiced");

  const isEmpty = invoices.length === 0 && dvis.length === 0 && serviceRecords.length === 0 && vehicles.length === 0;

  return (
    <PortalShell org={org}>
      <div>
        <h1 className="text-2xl font-bold">Documents</h1>
        <p className="mt-1 text-sm text-gray-400">Your invoices, inspection reports and service records with {org.name}.</p>
      </div>

      {isEmpty ? (
        <Empty title="Nothing here yet" body="Your invoices, inspection reports and service records will collect here as work is done." />
      ) : (
        <>
          {invoices.length > 0 && (
            <Section icon={<Receipt className="h-4 w-4" />} title="Invoices">
              {invoices.map((inv) => (
                <DocRow
                  key={inv.id}
                  href={`/invoice/${inv.id}`}
                  orgColor={org.primary_color}
                  icon={<Receipt className="h-5 w-5" style={{ color: org.primary_color }} />}
                  title={inv.invoice_number}
                  meta={`${fmtDate(inv.issued_at)} · ${fmt(inv.total)} · ${inv.status === "paid" ? "Paid" : "Unpaid"}`}
                />
              ))}
            </Section>
          )}

          {dvis.length > 0 && (
            <Section icon={<Video className="h-4 w-4" />} title="Inspection reports">
              {dvis.map((d) => (
                <DocRow
                  key={d.id}
                  href={`/dashboard/quotes/${d.id}`}
                  orgColor={org.primary_color}
                  icon={<Video className="h-5 w-5" style={{ color: org.primary_color }} />}
                  title={d.title || "Vehicle inspection"}
                  meta={fmtDate(d.created_at)}
                />
              ))}
            </Section>
          )}

          {serviceRecords.length > 0 && (
            <Section icon={<Wrench className="h-4 w-4" />} title="Service records">
              {serviceRecords.map((j) => (
                <DocRow
                  key={j.id}
                  href={`/dashboard/history/${j.id}`}
                  orgColor={org.primary_color}
                  icon={<Wrench className="h-5 w-5" style={{ color: org.primary_color }} />}
                  title={j.description || "Service"}
                  meta={`${fmtDate(j.completed_at)}${j.vehicle ? ` · ${j.vehicle.registration}` : ""}`}
                />
              ))}
            </Section>
          )}

          {vehicles.length > 0 && (
            <Section icon={<FileCheck className="h-4 w-4" />} title="MOT history">
              {vehicles.map((v) => (
                <a
                  key={v.id}
                  href={motHistoryUrl(v.registration)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-sm transition-colors hover:bg-white/[0.06]"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ backgroundColor: `${org.primary_color}25` }}>
                      <FileCheck className="h-5 w-5" style={{ color: org.primary_color }} />
                    </div>
                    <div>
                      <p className="font-mono font-semibold tracking-widest">{v.registration}</p>
                      <p className="text-xs text-gray-400">Official MOT history on GOV.UK</p>
                    </div>
                  </div>
                  <ExternalLink className="h-4 w-4 shrink-0 text-gray-500" />
                </a>
              ))}
            </Section>
          )}
        </>
      )}
    </PortalShell>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-gray-500">
        {icon} {title}
      </h2>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

function DocRow({ href, icon, title, meta, orgColor }: { href: string; icon: React.ReactNode; title: string; meta: string; orgColor: string }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-sm transition-colors hover:bg-white/[0.06]"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ backgroundColor: `${orgColor}25` }}>
          {icon}
        </div>
        <div>
          <p className="font-semibold">{title}</p>
          <p className="text-xs text-gray-400">{meta}</p>
        </div>
      </div>
      <ChevronRight className="h-5 w-5 shrink-0 text-gray-500" />
    </Link>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center backdrop-blur-sm">
      <FolderOpen className="mx-auto mb-3 h-8 w-8 text-gray-600" />
      <p className="font-semibold">{title}</p>
      <p className="mt-2 text-sm text-gray-400">{body}</p>
    </div>
  );
}
