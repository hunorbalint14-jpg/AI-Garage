import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { BookingWidgetForm } from "./booking-widget-form";

export default async function BookingWidgetPage() {
  const headersList = await headers();
  const slug = headersList.get("x-tenant-slug");
  if (!slug) redirect("/");

  const admin = createAdminClient();

  const { data: location } = await admin
    .from("locations")
    .select("id, name, organization:organizations(id, name, primary_color, logo_url, privacy_policy_url, stripe_account_id, stripe_charges_enabled)")
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

  const { data: servicesData } = await admin
    .from("services")
    .select("id, name, category, duration_minutes, price")
    .eq("location_id", location.id)
    .eq("active", true)
    .order("category")
    .order("name");

  const services = (servicesData ?? []) as {
    id: string;
    name: string;
    category: string;
    duration_minutes: number;
    price: number | null;
  }[];

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
      .eq("location_id", location.id)
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
            <p className="text-xs text-gray-500">Book an appointment</p>
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

        <BookingWidgetForm
          orgColor={org.primary_color}
          garageName={org.name}
          services={services}
          privacyPolicyUrl={org.privacy_policy_url}
          prefill={prefill}
          paymentsEnabled={paymentsEnabled}
        />
      </div>
    </div>
  );
}
