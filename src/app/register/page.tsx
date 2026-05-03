import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenant } from "@/lib/tenant-data";
import { RegisterForm } from "./register-form";
import { AnimatedBackground } from "@/components/animated-background";

export default async function RegisterPage() {
  const tenant = await getCurrentTenant();
  if (!tenant) redirect("/");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  const { name: orgName, primary_color: primaryColor, logo_url: logoUrl } = tenant.organization;

  return (
    <div className="relative min-h-screen bg-[#050c1a] text-white overflow-x-hidden">
      <AnimatedBackground brandColor={primaryColor} />

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
        <RegisterForm garageName={orgName} primaryColor={primaryColor} />
      </main>
    </div>
  );
}
