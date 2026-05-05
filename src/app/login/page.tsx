import Link from "next/link";
import { CustomerLoginForm } from "./login-form";
import { getCurrentTenant } from "@/lib/tenant-data";
import { AnimatedBackground } from "@/components/animated-background";

export default async function CustomerLoginPage() {
  const tenant = await getCurrentTenant();
  const orgName = tenant?.organization.name ?? "AI Garage";
  const primaryColor = tenant?.organization.primary_color ?? "#6366f1";
  const logoUrl = tenant?.organization.logo_url ?? null;

  return (
    <div className="relative min-h-screen bg-[#050c1a] text-white overflow-x-hidden">
      <AnimatedBackground brandColor={tenant ? primaryColor : undefined} />

      <nav className="relative z-10 flex items-center justify-between px-6 py-5 max-w-6xl mx-auto">
        <Link href="/" className="flex items-center gap-3">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={orgName} className="h-8 w-auto object-contain" />
          ) : (
            <div
              className="flex h-9 w-9 items-center justify-center rounded-lg text-sm font-bold text-white"
              style={{ backgroundColor: primaryColor }}
            >
              {orgName.split(/\s+/).map((w) => w[0]).join("").toUpperCase().slice(0, 2)}
            </div>
          )}
          <span className="text-base font-semibold">{orgName}</span>
        </Link>
      </nav>

      <main className="relative z-10 flex min-h-[calc(100vh-72px)] items-center justify-center px-6 pb-12">
        <CustomerLoginForm garageName={orgName} primaryColor={primaryColor} />
      </main>
    </div>
  );
}
