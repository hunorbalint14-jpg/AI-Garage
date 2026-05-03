import Link from "next/link";
import { CustomerLoginForm } from "./login-form";
import { getCurrentTenant } from "@/lib/tenant-data";

export default async function CustomerLoginPage() {
  const tenant = await getCurrentTenant();
  const orgName = tenant?.organization.name ?? "Garage-AI";
  const primaryColor = tenant?.organization.primary_color ?? "#4f46e5";
  const logoUrl = tenant?.organization.logo_url ?? null;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Branded header strip */}
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
        <CustomerLoginForm garageName={orgName} primaryColor={primaryColor} />
      </main>
    </div>
  );
}
