import { CustomerLoginForm } from "./login-form";
import { getCurrentTenant } from "@/lib/garages";

export default async function CustomerLoginPage() {
  const tenant = await getCurrentTenant();

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <CustomerLoginForm garageName={tenant?.name ?? "Garage-AI"} />
    </main>
  );
}
