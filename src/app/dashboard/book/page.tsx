import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { AnimatedBackground } from "@/components/animated-background";
import { CustomerSignOutButton } from "../sign-out-button";
import { BookingRequestForm } from "./booking-request-form";

export default async function BookPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const headersList = await headers();
  const slug = headersList.get("x-tenant-slug");
  if (!slug) redirect("/");

  const admin = createAdminClient();

  const { data: location } = await admin
    .from("locations")
    .select("id, name, organization:organizations(id, name, primary_color, logo_url)")
    .eq("slug", slug)
    .maybeSingle() as {
    data: { id: string; name: string; organization: { id: string; name: string; primary_color: string; logo_url: string | null } | null } | null;
  };

  if (!location?.organization) redirect("/");

  const { data: customer } = await admin
    .from("customers")
    .select("id")
    .eq("location_id", location.id)
    .or(`user_id.eq.${user.id},email.eq.${user.email ?? ""}`)
    .maybeSingle();

  const vehicles = customer
    ? ((await admin.from("vehicles").select("id, registration, make, model").eq("customer_id", customer.id).order("created_at", { ascending: false })).data ?? [])
    : [];

  const orgColor = location.organization.primary_color;
  const orgName = location.organization.name;
  const logoUrl = location.organization.logo_url;

  return (
    <div className="relative min-h-screen bg-[#050c1a] text-white overflow-x-hidden">
      <AnimatedBackground brandColor={orgColor} />

      <header className="relative z-10 border-b border-white/5 px-6 py-4 backdrop-blur-sm">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <div className="flex items-center gap-3">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt={orgName} className="h-8 w-auto object-contain" />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold text-white" style={{ backgroundColor: orgColor }}>
                {orgName.split(/\s+/).map((w) => w[0]).join("").toUpperCase().slice(0, 2)}
              </div>
            )}
            <span className="text-sm font-semibold">{orgName}</span>
          </div>
          <CustomerSignOutButton />
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-2xl px-6 py-10">
        <div className="mb-8">
          <a href="/dashboard" className="text-sm text-gray-400 hover:text-white transition-colors">
            ← Back to dashboard
          </a>
          <h1 className="mt-3 text-2xl font-bold">Request an appointment</h1>
          <p className="mt-1 text-sm text-gray-400">
            Tell {orgName} when you&apos;d like to come in and they&apos;ll confirm your booking.
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-sm">
          <BookingRequestForm vehicles={vehicles as { id: string; registration: string; make: string | null; model: string | null }[]} orgColor={orgColor} />
        </div>
      </main>
    </div>
  );
}
