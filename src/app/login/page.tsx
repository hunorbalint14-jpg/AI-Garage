import { CustomerLoginForm } from "./login-form";
import { getCurrentTenant } from "@/lib/tenant-data";

export default async function CustomerLoginPage() {
  const tenant = await getCurrentTenant();

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <CustomerLoginForm
        garageName={tenant?.organization.name ?? "Garage-AI"}
      />
    </main>
  );
}
