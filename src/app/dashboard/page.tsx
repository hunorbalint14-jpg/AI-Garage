import Link from "next/link";
import { Car, AlertCircle, Clock, CheckCircle, CalendarDays, Receipt } from "lucide-react";
import { BookingCard } from "./booking-card";
import { DiagnosticPanel } from "./diagnostic-panel";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortalContext } from "@/lib/portal-auth";
import { AnimatedBackground } from "@/components/animated-background";
import { NavProgressProvider, NavProgressOverlay } from "@/components/nav-progress";
import { CustomerSignOutButton } from "./sign-out-button";
import { PortalNav } from "./portal-nav";

type Vehicle = {
  id: string;
  registration: string;
  make: string | null;
  model: string | null;
  year: number | null;
  mot_expiry: string | null;
  service_due: string | null;
  tax_due_date: string | null;
};

type InvoiceRow = {
  id: string;
  invoice_number: string;
  total: number;
  status: string;
  issued_at: string;
  due_at: string;
};

type BookingRow = {
  id: string;
  scheduled_at: string;
  type: string;
  status: string;
  duration_minutes: number;
  vehicle: { registration: string } | null;
};

function formatDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function dueDays(d: string | null): number | null {
  if (!d) return null;
  return Math.ceil((new Date(d).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function dueBadge(d: string | null) {
  const days = dueDays(d);
  if (days === null) return null;
  if (days < 0)
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-500/20 px-2.5 py-0.5 text-xs font-semibold text-red-400">
        <AlertCircle className="h-3 w-3" /> Overdue
      </span>
    );
  if (days <= 30)
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-500/20 px-2.5 py-0.5 text-xs font-semibold text-red-400">
        <Clock className="h-3 w-3" /> Due in {days}d
      </span>
    );
  if (days <= 60)
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2.5 py-0.5 text-xs font-medium text-amber-400">
        <Clock className="h-3 w-3" /> Due in {days}d
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-green-500/20 px-2.5 py-0.5 text-xs text-green-400">
      <CheckCircle className="h-3 w-3" /> OK
    </span>
  );
}

function fmt(n: number) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
}

function typeLabel(t: string) {
  return t === "mot" ? "MOT" : t.charAt(0).toUpperCase() + t.slice(1);
}

export default async function CustomerDashboard() {
  const { user, location, customer } = await getPortalContext();

  const admin = createAdminClient();
  const now = new Date().toISOString();

  const [vehiclesRes, invoicesRes, bookingsRes] = customer
    ? await Promise.all([
        admin
          .from("vehicles")
          .select("id, registration, make, model, year, mot_expiry, service_due, tax_due_date")
          .eq("customer_id", customer.id)
          .order("created_at", { ascending: false }),
        admin
          .from("invoices")
          .select("id, invoice_number, total, status, issued_at, due_at")
          .eq("customer_id", customer.id)
          .order("issued_at", { ascending: false })
          .limit(5),
        admin
          .from("bookings")
          .select("id, scheduled_at, type, status, duration_minutes, vehicle:vehicles(registration)")
          .eq("customer_id", customer.id)
          .gte("scheduled_at", now)
          .in("status", ["scheduled", "in_progress"])
          .order("scheduled_at", { ascending: true })
          .limit(5),
      ])
    : [{ data: null }, { data: null }, { data: null }];

  const vehicles = (vehiclesRes.data ?? []) as Vehicle[];
  const invoices = (invoicesRes.data ?? []) as unknown as InvoiceRow[];
  const bookings = (bookingsRes.data ?? []) as unknown as BookingRow[];

  const firstName = customer?.full_name?.split(" ")[0] ?? user.email?.split("@")[0] ?? "there";
  const orgColor = location.organization.primary_color;
  const orgName = location.organization.name;
  const logoUrl = location.organization.logo_url;

  return (
    <NavProgressProvider>
    <div className="relative min-h-screen bg-[#050c1a] text-white overflow-x-hidden">
      <AnimatedBackground brandColor={orgColor} />

      <header className="relative z-10 border-b border-white/5 px-6 py-4 backdrop-blur-sm">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <div className="flex items-center gap-3">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt={orgName} className="h-8 w-auto object-contain" />
            ) : (
              <div
                className="flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold text-white"
                style={{ backgroundColor: orgColor }}
              >
                {orgName.split(/\s+/).map((w) => w[0]).join("").toUpperCase().slice(0, 2)}
              </div>
            )}
            <span className="text-sm font-semibold">{orgName}</span>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard/book"
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-white/10 hover:text-white transition-colors"
              style={{ borderColor: `${orgColor}40` }}
            >
              + Book appointment
            </Link>
            <CustomerSignOutButton />
          </div>
        </div>
      </header>

      <div className="relative z-10 mx-auto max-w-2xl px-6">
        <PortalNav orgColor={orgColor} />
      </div>

      <main className="relative z-10 mx-auto max-w-2xl px-6 py-10 flex flex-col gap-10">
        <div>
          <h1 className="text-3xl font-bold">Hi {firstName} 👋</h1>
          <p className="mt-1 text-sm text-gray-400">
            Your vehicles and appointments with {orgName}.
          </p>
        </div>

        {/* Vehicles */}
        <section>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-500 flex items-center gap-2">
            <Car className="h-4 w-4" /> Your vehicles
          </h2>
          {!customer ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center backdrop-blur-sm">
              <p className="font-semibold">No account found</p>
              <p className="mt-2 text-sm text-gray-400">
                We couldn&apos;t find a customer record linked to{" "}
                <span className="text-white">{user.email}</span>. Please contact {orgName}.
              </p>
            </div>
          ) : vehicles.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center text-sm text-gray-400 backdrop-blur-sm">
              No vehicles on file yet. Contact {orgName} to add your car.
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {vehicles.map((v) => {
                const name = [v.year, v.make, v.model].filter(Boolean).join(" ") || "Vehicle";
                const motDays = dueDays(v.mot_expiry);
                const needsAttention = motDays !== null && motDays <= 30;
                return (
                  <div
                    key={v.id}
                    className={`rounded-2xl border p-5 backdrop-blur-sm ${
                      needsAttention ? "border-red-500/30 bg-red-500/[0.05]" : "border-white/10 bg-white/[0.03]"
                    }`}
                  >
                    <div className="mb-4 flex items-start justify-between gap-2">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ backgroundColor: `${orgColor}25` }}>
                          <Car className="h-5 w-5" style={{ color: orgColor }} />
                        </div>
                        <div>
                          <p className="font-mono text-base font-bold tracking-widest">{v.registration}</p>
                          <p className="text-sm text-gray-400">{name}</p>
                        </div>
                      </div>
                      {needsAttention && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-500/20 px-2.5 py-1 text-xs font-bold text-red-400">
                          <AlertCircle className="h-3 w-3" /> Action needed
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      {[{ label: "MOT expiry", date: v.mot_expiry }, { label: "Service due", date: v.service_due }, { label: "Road tax due", date: v.tax_due_date }].map(({ label, date }) => (
                        <div key={label} className="rounded-xl bg-white/5 p-3">
                          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500">{label}</p>
                          <p className="font-semibold">{formatDate(date)}</p>
                          <div className="mt-2">{dueBadge(date)}</div>
                        </div>
                      ))}
                    </div>
                    <Link
                      href={`/dashboard/mot/${v.id}`}
                      className="mt-3 inline-block text-xs font-semibold underline text-gray-400 hover:text-white transition-colors"
                    >
                      View full MOT history →
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Upcoming bookings */}
        {bookings.length > 0 && (
          <section>
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-500 flex items-center gap-2">
              <CalendarDays className="h-4 w-4" /> Upcoming appointments
            </h2>
            <div className="flex flex-col gap-3">
              {bookings.map((b) => (
                <BookingCard key={b.id} booking={b} orgColor={orgColor} />
              ))}
            </div>
          </section>
        )}

        {/* AI Diagnostic */}
        {customer && vehicles.length > 0 && (
          <DiagnosticPanel vehicles={vehicles} orgColor={orgColor} />
        )}

        {/* Invoices */}
        {invoices.length > 0 && (
          <section>
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-500 flex items-center gap-2">
              <Receipt className="h-4 w-4" /> Recent invoices
            </h2>
            <div className="flex flex-col gap-2">
              {invoices.map((inv) => {
                const overdue = inv.status !== "paid" && new Date(inv.due_at) < new Date();
                const computedStatus = overdue ? "overdue" : inv.status;
                const statusStyle: Record<string, string> = {
                  draft: "bg-gray-500/20 text-gray-400",
                  sent: "bg-blue-500/20 text-blue-400",
                  paid: "bg-green-500/20 text-green-400",
                  overdue: "bg-red-500/20 text-red-400",
                };
                return (
                  <Link
                    key={inv.id}
                    href={`/invoice/${inv.id}`}
                    className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 flex items-center justify-between gap-4 hover:bg-white/[0.06] transition-colors backdrop-blur-sm"
                  >
                    <div>
                      <p className="font-semibold font-mono text-sm">{inv.invoice_number}</p>
                      <p className="text-xs text-gray-400">{formatDate(inv.issued_at)}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-semibold tabular-nums">{fmt(inv.total)}</span>
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${statusStyle[computedStatus] ?? ""}`}>
                        {computedStatus}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        )}
      </main>

      <NavProgressOverlay />
    </div>
    </NavProgressProvider>
  );
}
