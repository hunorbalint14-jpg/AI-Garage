import { PlatformLoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default function PlatformLoginPage() {
  return (
    <div className="grid min-h-screen place-items-center px-6">
      <PlatformLoginForm />
    </div>
  );
}
