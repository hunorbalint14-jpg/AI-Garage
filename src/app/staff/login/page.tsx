import Link from "next/link";
import { StaffLoginForm } from "./login-form";
import { getCurrentTenant } from "@/lib/tenant-data";
import { AnimatedBackground } from "@/components/animated-background";

type Props = {
  searchParams: Promise<{ email?: string }>;
};

export default async function StaffLoginPage({ searchParams }: Props) {
  const params = await searchParams;
  const tenant = await getCurrentTenant();
  const primaryColor = tenant?.organization.primary_color;

  return (
    <div className="relative min-h-screen bg-[#050c1a] text-white">
      <AnimatedBackground brandColor={primaryColor} />

      <nav className="relative z-10 flex items-center justify-between px-6 py-5 max-w-6xl mx-auto">
        <Link href="/" className="text-base font-bold tracking-tight">
          {tenant ? (
            <span style={{ color: primaryColor ?? "#fff" }}>{tenant.organization.name}</span>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src="/brand/logo/aigarage-logo-horizontal-on-dark.svg" alt="AI Garage" className="h-8 w-auto" />
          )}
        </Link>
      </nav>

      <main className="relative z-10 flex min-h-[calc(100vh-72px)] items-center justify-center px-6 pb-12">
        <StaffLoginForm initialEmail={params.email ?? ""} accentColor={primaryColor} />
      </main>
    </div>
  );
}
