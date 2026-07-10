import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyQuoteAccess } from "@/lib/quote-links";
import { resolveDeferredBooking, type DeferredBookingContext } from "@/lib/deferred-followup";
import { BookingWidgetForm } from "./booking-widget-form";
import { parseWeeklyHours, formatWeeklySummary, APP_TZ, type WeeklyHours, type SpecialHours } from "@/lib/business-hours";
import { cachedActiveServices, cachedLocationHours } from "@/lib/location-cache";

export default async function BookingWidgetPage({
  searchParams,
}: {
  searchParams: Promise<{ quote?: string; t?: string; dw?: string }>;
}) {
  const headersList = await headers();
  const slug = headersList.get("x-tenant-slug");
  if (!slug) redirect("/");

  const { quote: quoteSlug, t: quoteToken, dw: deferredToken } = await searchParams;

  const admin = createAdminClient();

  const { data: location } = await admin
    .from("locations")
    .select("id, name, organization:organizations!organization_id(id, name, primary_color, logo_url, privacy_policy_url, stripe_account_id, stripe_charges_enabled)")
    .eq("slug", slug)
    .maybeSingle() as {
    data: {
      id: string;
      name: string;
      organization: {
        id: string;
        name: string;
        primary_color: string;
        logo_url: string | null;
        privacy_policy_url: string | null;
        stripe_account_id: string | null;
        stripe_charges_enabled: boolean | null;
      } | null;
    } | null;
  };

  if (!location?.organization) redirect("/");

  const org = location.organization;

  // Every branch in the org + each branch's active services, so the widget's
  // branch picker can re-filter the services list per branch. The subdomain
  // resolves to the org; `location` (slug-matched) is the default landing branch.
  type Service = {
    id: string;
    name: string;
    category: string;
    duration_minutes: number;
    price: number | null;
  };
  const { data: branchData } = await admin
    .from("locations")
    .select("id, name")
    .eq("organization_id", org.id)
    .order("name");
  const locations = (branchData ?? []) as { id: string; name: string }[];

  // Per-branch weekly hours + upcoming overrides (so the widget can show the
  // resolved hours / "Closed" for the picked date; the server re-checks before
  // creating any booking) and the bookable services — all from the per-location
  // cache, so anonymous widget traffic doesn't hit Postgres per page view.
  const todayKey = new Date().toLocaleDateString("en-CA", { timeZone: APP_TZ });
  const perBranch = await Promise.all(
    locations.map(async (l) => ({
      id: l.id,
      hours: await cachedLocationHours(l.id, todayKey),
      services: await cachedActiveServices(l.id),
    })),
  );

  const weeklyByLocation: Record<string, WeeklyHours> = {};
  const specialByLocation: Record<string, SpecialHours[]> = {};
  const servicesByLocation: Record<string, Service[]> = {};
  for (const b of perBranch) {
    weeklyByLocation[b.id] = parseWeeklyHours(b.hours.weekly);
    specialByLocation[b.id] = b.hours.special.map((s) => ({
      date: s.date,
      isClosed: s.is_closed,
      openMinute: s.open_minute,
      closeMinute: s.close_minute,
    }));
    servicesByLocation[b.id] = b.services.map((s) => ({ ...s, category: s.category ?? "" }));
  }
  const defaultLocationId = location.id;

  // If the visitor is already logged in as a customer, pre-fill the form
  // and skip the contact-details prompt.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let prefill: {
    customerId: string | null;
    fullName: string;
    email: string;
    phone: string;
  } | null = null;
  if (user?.email) {
    const { data: customer } = await admin
      .from("customers")
      .select("id, full_name, email, phone")
      .eq("organization_id", location.organization.id)
      .eq("email", user.email)
      .maybeSingle();
    if (customer) {
      prefill = {
        customerId: customer.id,
        fullName: customer.full_name ?? "",
        email: customer.email ?? user.email,
        phone: customer.phone ?? "",
      };
    } else {
      prefill = {
        customerId: null,
        fullName: "",
        email: user.email,
        phone: "",
      };
    }
  }

  const paymentsEnabled =
    !!org.stripe_account_id && !!org.stripe_charges_enabled;

  // If the customer arrived from a "Decline & book" quote link, prefetch the
  // quote context (items + total + customer details) so we can prefill the
  // form and surface "Booking based on quote from X" copy.
  type QuoteContext = {
    slug: string;
    token: string;
    title: string | null;
    items: { description: string; type: string; quantity: number; unit_price: number }[];
    total: number;
    customer: { full_name: string | null; email: string | null; phone: string | null } | null;
    vehicle: { registration: string | null } | null;
  } | null;
  let quoteContext: QuoteContext = null;
  if (quoteSlug && quoteToken) {
    // Accept both pending (rare race) and rebooked, since the customer just
    // pressed declineAndRebook which flipped the status.
    const verify = await verifyQuoteAccess(quoteSlug, quoteToken, ["rebooked", "pending"]);
    if (verify.ok && verify.quote.location_id === location.id) {
      const { data: items } = await admin
        .from("quote_items")
        .select("description, type, quantity, unit_price")
        .eq("quote_id", verify.quote.id)
        .order("sort_order");
      const { data: full } = await admin
        .from("quotes")
        .select("title, total, quote_type, customer:customers(full_name, email, phone), vehicle:vehicles(registration), job:jobs(customer:customers(full_name, email, phone), vehicle:vehicles(registration))")
        .eq("id", verify.quote.id)
        .maybeSingle();
      type PersonRef = { full_name: string | null; email: string | null; phone: string | null } | null;
      type FullRow = {
        title: string | null;
        total: number;
        quote_type: "job" | "standalone";
        customer: PersonRef;
        vehicle: { registration: string | null } | null;
        job: { customer: PersonRef; vehicle: { registration: string | null } | null } | null;
      };
      const fullRow = full as FullRow | null;
      if (fullRow) {
        // Standalone quotes carry customer/vehicle directly; DVI quotes derive
        // them from the parent job.
        const qCustomer = fullRow.quote_type === "job" ? fullRow.job?.customer ?? null : fullRow.customer;
        const qVehicle = fullRow.quote_type === "job" ? fullRow.job?.vehicle ?? null : fullRow.vehicle;
        quoteContext = {
          slug: quoteSlug,
          token: quoteToken,
          title: fullRow.title,
          items: (items ?? []).map((it) => it as { description: string; type: string; quantity: number; unit_price: number }),
          total: Number(fullRow.total),
          customer: qCustomer,
          vehicle: qVehicle,
        };
        // Prefill from the quote's customer if no auth-session prefill exists.
        if (!prefill && quoteContext.customer?.email) {
          prefill = {
            customerId: null,
            fullName: quoteContext.customer.full_name ?? "",
            email: quoteContext.customer.email,
            phone: quoteContext.customer.phone ?? "",
          };
        }
      }
    }
  }

  // Deferred-work follow-up link (#498): "?dw=<token>" from the recovery
  // message. Resolves to the outstanding items for a banner + prefill; the
  // token rides a hidden field to createBooking, which marks the covered
  // records recovered. An invalid/spent token degrades to the plain widget.
  let deferredContext: DeferredBookingContext | null = null;
  if (deferredToken) {
    deferredContext = await resolveDeferredBooking(admin, deferredToken);
    if (deferredContext && !prefill && deferredContext.customer?.email) {
      prefill = {
        customerId: deferredContext.customer.id,
        fullName: deferredContext.customer.full_name ?? "",
        email: deferredContext.customer.email,
        phone: deferredContext.customer.phone ?? "",
      };
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-start justify-center p-4 pt-8">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-md border border-black/[0.06] p-7">
        {/* Header */}
        <div className="flex items-center gap-3 mb-5 pb-5 border-b border-gray-100">
          {org.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={org.logo_url} alt={org.name} className="h-9 max-w-[120px] object-contain" />
          ) : (
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-sm font-bold shrink-0"
              style={{ backgroundColor: org.primary_color }}
            >
              {org.name.split(/\s+/).map((w: string) => w[0]).join("").toUpperCase().slice(0, 2)}
            </div>
          )}
          <div className="flex-1">
            <p className="font-bold text-gray-900 leading-tight">{org.name}</p>
            {/* Hours up front (UX review §1h) — landing branch's week. */}
            <p className="text-xs text-gray-500">
              Open {formatWeeklySummary(weeklyByLocation[defaultLocationId] ?? {})}
            </p>
          </div>
          {prefill ? (
            <a
              href="/dashboard"
              className="text-xs text-gray-500 underline hover:text-gray-700"
            >
              My account →
            </a>
          ) : (
            <a
              href="/login?next=/book"
              className="text-xs text-gray-500 underline hover:text-gray-700"
            >
              Sign in →
            </a>
          )}
        </div>

        {deferredContext && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-amber-700 mb-1">Advised work</div>
            <p className="text-sm text-slate-700">
              Booking in the work we advised
              {deferredContext.vehicle?.registration ? ` for ${deferredContext.vehicle.registration}` : ""}.
            </p>
            <ul className="mt-2 text-xs text-slate-600 list-disc list-inside">
              {deferredContext.items.map((it, i) => (
                <li key={i}>
                  {it.description}
                  {it.price !== null && <span className="text-slate-400"> · £{it.price.toFixed(2)}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {quoteContext && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-amber-700 mb-1">From quote</div>
            <p className="text-sm text-slate-700">
              Booking based on the additional-work quote you received{quoteContext.vehicle?.registration ? ` for ${quoteContext.vehicle.registration}` : ""}.
            </p>
            <ul className="mt-2 text-xs text-slate-600 list-disc list-inside">
              {quoteContext.items.map((it, i) => (
                <li key={i}>
                  {it.description} <span className="text-slate-400">· {it.type} · {it.quantity}×</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <BookingWidgetForm
          orgColor={org.primary_color}
          garageName={org.name}
          locations={locations}
          servicesByLocation={servicesByLocation}
          weeklyByLocation={weeklyByLocation}
          specialByLocation={specialByLocation}
          defaultLocationId={defaultLocationId}
          privacyPolicyUrl={org.privacy_policy_url}
          prefill={prefill}
          paymentsEnabled={paymentsEnabled}
          fromQuoteSlug={quoteContext?.slug ?? null}
          fromQuoteToken={quoteContext?.token ?? null}
          fromDeferredToken={deferredContext ? (deferredToken ?? null) : null}
        />
      </div>
    </div>
  );
}
