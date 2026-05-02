import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { CustomerSignOutButton } from "./sign-out-button";

type Vehicle = {
  id: string;
  registration: string;
  make: string | null;
  model: string | null;
  year: number | null;
  mot_expiry: string | null;
  service_due: string | null;
};

function formatDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function dueDays(d: string | null): number | null {
  if (!d) return null;
  return Math.ceil((new Date(d).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function dueBadge(d: string | null) {
  const days = dueDays(d);
  if (days === null) return null;
  if (days < 0)
    return <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">Overdue</span>;
  if (days <= 30)
    return <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">Due in {days}d</span>;
  if (days <= 60)
    return <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">Due in {days}d</span>;
  return null;
}

export default async function CustomerDashboard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const headersList = await headers();
  const slug = headersList.get("x-tenant-slug");
  if (!slug) redirect("/");

  const admin = createAdminClient();

  // Resolve the tenant
  const { data: location } = await admin
    .from("locations")
    .select("id, name, organization:organizations(id, name, primary_color, logo_url)")
    .eq("slug", slug)
    .maybeSingle() as { data: { id: string; name: string; organization: { id: string; name: string; primary_color: string; logo_url: string | null } | null } | null };

  if (!location || !location.organization) redirect("/");

  // Find and optionally link the customer record by email
  const { data: customer } = await admin
    .from("customers")
    .select("id, full_name, user_id")
    .eq("location_id", location.id)
    .eq("email", user.email ?? "")
    .maybeSingle();

  if (customer && !customer.user_id) {
    await admin
      .from("customers")
      .update({ user_id: user.id })
      .eq("id", customer.id);
  }

  const { data: vehicles } = customer
    ? (await admin
        .from("vehicles")
        .select("id, registration, make, model, year, mot_expiry, service_due")
        .eq("customer_id", customer.id)
        .order("created_at", { ascending: false })) as { data: Vehicle[] | null }
    : { data: null };

  const firstName = customer?.full_name?.split(" ")[0] ?? user.email?.split("@")[0] ?? "there";
  const orgColor = location.organization.primary_color;
  const orgName = location.organization.name;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="border-b bg-white px-6 py-4">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <h1 className="text-lg font-bold" style={{ color: orgColor }}>
            {orgName}
          </h1>
          <CustomerSignOutButton />
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-8">
        <div className="mb-6">
          <h2 className="text-2xl font-bold">Hi {firstName} 👋</h2>
          <p className="text-sm text-muted-foreground">
            Here are your vehicles registered with {orgName}.
          </p>
        </div>

        {!customer ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <p className="text-sm font-medium">No account found</p>
            <p className="mt-1 text-sm text-muted-foreground">
              We couldn&apos;t find a customer record linked to{" "}
              <strong>{user.email}</strong>. Please contact {orgName} to ensure
              your email is registered correctly.
            </p>
          </div>
        ) : !vehicles || vehicles.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            No vehicles on file yet. Contact {orgName} to add your car.
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {vehicles.map((v) => {
              const name = [v.year, v.make, v.model].filter(Boolean).join(" ") || "Vehicle";
              const motDays = dueDays(v.mot_expiry);
              const svcDays = dueDays(v.service_due);
              return (
                <div key={v.id} className="rounded-lg border bg-white p-4 shadow-sm">
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <div>
                      <p className="font-mono text-lg font-bold">{v.registration}</p>
                      <p className="text-sm text-muted-foreground">{name}</p>
                    </div>
                    {(motDays !== null && motDays <= 30) && (
                      <span className="rounded bg-red-100 px-2 py-1 text-xs font-bold text-red-700 uppercase tracking-wide">
                        Action needed
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-md bg-gray-50 p-3">
                      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        MOT expiry
                      </p>
                      <p className="font-medium">{formatDate(v.mot_expiry)}</p>
                      <div className="mt-1">{dueBadge(v.mot_expiry)}</div>
                    </div>
                    <div className="rounded-md bg-gray-50 p-3">
                      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Service due
                      </p>
                      <p className="font-medium">{formatDate(v.service_due)}</p>
                      <div className="mt-1">{dueBadge(v.service_due)}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
