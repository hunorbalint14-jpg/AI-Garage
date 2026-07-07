import Link from "next/link";
import { Car, CalendarDays, Receipt } from "lucide-react";
import { BookingCard } from "./booking-card";
import { DiagnosticPanel } from "./diagnostic-panel";
import { NextUpHero, type HeroAction } from "./next-up-hero";
import { VehicleRow } from "./vehicle-row";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortalContext } from "@/lib/portal-auth";
import { cachedActiveServices } from "@/lib/location-cache";
import { getAvailableSlotsWeek } from "@/lib/slots-actions";
import { APP_TZ } from "@/lib/business-hours";
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
  location: { id: string; name: string; address: string | null } | null;
};

type QuoteRow = { id: string; title: string | null; total: number; expires_at: string | null };

function formatDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function dueDays(d: string | null): number | null {
  if (!d) return null;
  return Math.ceil((new Date(d).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function fmt(n: number) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
}

// The single most urgent item across all vehicles ∪ pending quotes
// (UX review §1g: min dueDays wins). Vehicle items count once they're
// inside 30 days (or overdue); a pending quote is always actionable and
// ranks by its expiry (14d stand-in when it has none).
function pickNextAction(
  vehicles: Vehicle[],
  quotes: QuoteRow[],
): { winner: { kind: "mot" | "service"; vehicle: Vehicle; days: number; date: string } | { kind: "quote"; quote: QuoteRow; days: number } | null; urgentCount: number } {
  const candidates: ({ kind: "mot" | "service"; vehicle: Vehicle; days: number; date: string } | { kind: "quote"; quote: QuoteRow; days: number })[] = [];
  for (const v of vehicles) {
    const mot = dueDays(v.mot_expiry);
    if (mot !== null && mot <= 30) candidates.push({ kind: "mot", vehicle: v, days: mot, date: v.mot_expiry! });
    const svc = dueDays(v.service_due);
    if (svc !== null && svc <= 30) candidates.push({ kind: "service", vehicle: v, days: svc, date: v.service_due! });
  }
  for (const q of quotes) {
    candidates.push({ kind: "quote", quote: q, days: dueDays(q.expires_at) ?? 14 });
  }
  if (candidates.length === 0) return { winner: null, urgentCount: 0 };
  candidates.sort((a, b) => a.days - b.days);
  return { winner: candidates[0], urgentCount: candidates.length };
}

export default async function CustomerDashboard() {
  const { user, location, customer } = await getPortalContext();

  const admin = createAdminClient();
  const now = new Date().toISOString();

  const [vehiclesRes, invoicesRes, bookingsRes, custRowRes, standaloneQuotesRes] = customer
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
          .select(
            "id, scheduled_at, type, status, duration_minutes, vehicle:vehicles(registration), location:locations(id, name, address)",
          )
          .eq("customer_id", customer.id)
          .gte("scheduled_at", now)
          // payment_pending included so an abandoned Stripe checkout is
          // recoverable from here (Complete payment → /book/[id]/pay).
          .in("status", ["scheduled", "in_progress", "payment_pending"])
          .order("scheduled_at", { ascending: true })
          .limit(5),
        admin.from("customers").select("preferred_location_id").eq("id", customer.id).maybeSingle(),
        admin
          .from("quotes")
          .select("id, title, total, expires_at")
          .eq("customer_id", customer.id)
          .eq("status", "pending")
          .order("created_at", { ascending: false })
          .limit(5),
      ])
    : [{ data: null }, { data: null }, { data: null }, { data: null }, { data: null }];

  const vehicles = (vehiclesRes.data ?? []) as Vehicle[];
  const invoices = (invoicesRes.data ?? []) as unknown as InvoiceRow[];
  const bookings = (bookingsRes.data ?? []) as unknown as BookingRow[];
  let pendingQuotes = (standaloneQuotesRes.data ?? []) as QuoteRow[];

  // DVI quotes hang off the customer's jobs rather than the customer directly.
  if (customer && pendingQuotes.length < 5) {
    const { data: jobRows } = await admin.from("jobs").select("id").eq("customer_id", customer.id).limit(50);
    const jobIds = (jobRows ?? []).map((j) => j.id);
    if (jobIds.length > 0) {
      const { data: jobQuotes } = await admin
        .from("quotes")
        .select("id, title, total, expires_at")
        .in("job_id", jobIds)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(5);
      pendingQuotes = [...pendingQuotes, ...((jobQuotes ?? []) as QuoteRow[])];
    }
  }

  const firstName = customer?.full_name?.split(" ")[0] ?? user.email?.split("@")[0] ?? "there";
  const orgColor = location.organization.primary_color;
  const orgName = location.organization.name;
  const logoUrl = location.organization.logo_url;

  // ── Next-up hero ────────────────────────────────────────────────────────
  const { winner, urgentCount } = pickNextAction(vehicles, pendingQuotes);
  let heroAction: HeroAction | null = null;
  if (winner) {
    if (winner.kind === "quote") {
      heroAction = {
        kind: "quote",
        quoteId: winner.quote.id,
        title: winner.quote.title,
        total: Number(winner.quote.total),
        expiresDays: dueDays(winner.quote.expires_at),
      };
    } else {
      // Bookable hero: resolve the matching service at the customer's home
      // branch (falling back to the landing branch), then prefetch a week of
      // real slots so the chips render server-side with no client fetch.
      const locId =
        ((custRowRes as { data: { preferred_location_id: string | null } | null }).data
          ?.preferred_location_id as string | null) ?? location.id;
      const services = await cachedActiveServices(locId);
      const rx = winner.kind === "mot" ? /mot/i : /service/i;
      const service =
        services.find((s) => rx.test(s.name) || rx.test(s.category ?? "")) ?? null;
      const week = service
        ? await getAvailableSlotsWeek(
            locId,
            new Date().toLocaleDateString("en-CA", { timeZone: APP_TZ }),
            service.duration_minutes || 60,
          )
        : null;
      const v = winner.vehicle;
      heroAction = {
        kind: winner.kind,
        vehicleId: v.id,
        vehicleName: [v.year, v.make, v.model].filter(Boolean).join(" ") || "Your vehicle",
        registration: v.registration,
        dueDate: winner.date,
        dueDays: winner.days,
        service: service
          ? { id: service.id, name: service.name, price: service.price, durationMinutes: service.duration_minutes || 60 }
          : null,
        locationId: locId,
        week,
      };
    }
  }

  const greeting =
    urgentCount === 0
      ? "you're all set."
      : urgentCount === 1
        ? "one thing needs booking."
        : `${urgentCount} things need attention.`;

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
          <CustomerSignOutButton />
        </div>
      </header>

      <div className="relative z-10 mx-auto max-w-2xl px-6">
        <PortalNav orgColor={orgColor} />
      </div>

      <main className="relative z-10 mx-auto max-w-2xl px-6 py-10 flex flex-col gap-10">
        {/* The greeting carries the state — no emoji (UX review F12). */}
        <div className="flex flex-col gap-5">
          <h1 className="text-2xl font-bold leading-snug">
            Hi {firstName} — {greeting}
          </h1>
          {heroAction && <NextUpHero action={heroAction} orgColor={orgColor} />}
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
            <div className="flex flex-col gap-3">
              {vehicles.map((v) => (
                <VehicleRow key={v.id} vehicle={v} />
              ))}
            </div>
          )}
        </section>

        {/* Upcoming bookings */}
        {bookings.length > 0 && (
          <section>
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-500 flex items-center gap-2">
              <CalendarDays className="h-4 w-4" /> Upcoming
            </h2>
            <div className="flex flex-col gap-3">
              {bookings.map((b) => (
                <BookingCard
                  key={b.id}
                  booking={b}
                  orgColor={orgColor}
                  garagePhone={location.organization.phone}
                />
              ))}
            </div>
          </section>
        )}

        {/* Book CTA lives in the flow now, not the header */}
        {customer && (
          <div>
            <Link
              href="/dashboard/book"
              className="inline-block rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-gray-300 hover:bg-white/10 hover:text-white transition-colors"
              style={{ borderColor: `${orgColor}40` }}
            >
              + Book an appointment
            </Link>
          </div>
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
