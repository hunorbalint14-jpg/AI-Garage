import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { BookingWidgetForm } from "./booking-widget-form";

export default async function BookingWidgetPage() {
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

  const org = location.organization;

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
          <div>
            <p className="font-bold text-gray-900 leading-tight">{org.name}</p>
            <p className="text-xs text-gray-500">Book an appointment</p>
          </div>
        </div>

        <BookingWidgetForm orgColor={org.primary_color} garageName={org.name} />
      </div>
    </div>
  );
}
