import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenant } from "@/lib/tenant-data";
import { RegisterForm } from "./register-form";

export default async function RegisterPage() {
  const tenant = await getCurrentTenant();
  if (!tenant) redirect("/");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  const primaryColor = tenant.organization.primary_color;
  const logoUrl = tenant.organization.logo_url;
  const orgName = tenant.organization.name;

  return (
    <div className="min-h-screen bg-gray-50">
      <div
        className="w-full border-b py-4 px-6 text-center"
        style={{ background: `${primaryColor}12`, borderColor: `${primaryColor}20` }}
      >
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt={orgName} className="mx-auto h-8 w-auto object-contain" />
        ) : (
          <Link href="/" className="text-base font-bold" style={{ color: primaryColor }}>
            {orgName}
          </Link>
        )}
      </div>

      <main className="flex min-h-[calc(100vh-57px)] items-center justify-center p-6">
        <RegisterForm garageName={orgName} primaryColor={primaryColor} />
      </main>
    </div>
  );
}
