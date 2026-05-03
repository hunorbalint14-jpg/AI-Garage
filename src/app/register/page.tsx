import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenant } from "@/lib/tenant-data";
import { RegisterForm } from "./register-form";

export default async function RegisterPage() {
  // Only available on a tenant subdomain
  const tenant = await getCurrentTenant();
  if (!tenant) redirect("/");

  // Already signed in → go straight to dashboard
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <RegisterForm garageName={tenant.organization.name} />
    </main>
  );
}
