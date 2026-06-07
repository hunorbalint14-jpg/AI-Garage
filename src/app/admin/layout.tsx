import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isPlatformAdmin } from "@/lib/platform-admin";
import { signOutPlatformAdmin } from "./login/actions";

// The platform-operator dashboard reads across ALL tenants via the service-role
// client, so this layout is the single access gate for every /admin/* route:
//   1. must be reached via the reserved admin host (x-platform-host header);
//   2. must be an authenticated user;
//   3. that user's email must be in the PLATFORM_ADMIN_EMAILS allowlist.
// The /admin/login route is exempt from (2)/(3) so the gate can't loop.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const h = await headers();
  if (h.get("x-platform-host") !== "1") notFound();

  const pathname = h.get("x-pathname") ?? "";
  const isLoginRoute = pathname.startsWith("/admin/login");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const allowed = isPlatformAdmin(user?.email);

  if (isLoginRoute) {
    // Already a valid operator? Skip the login screen.
    if (user && allowed) redirect("/admin");
    return <div className="min-h-screen bg-[#0f1115] text-[#e6e8eb]">{children}</div>;
  }

  if (!user) redirect("/admin/login");
  if (!allowed) notFound();

  return (
    <div className="min-h-screen bg-[#0f1115] text-[#e6e8eb]">
      <header className="sticky top-0 z-10 border-b border-[#23272f] bg-[#15181d]/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-6">
            <Link href="/admin" className="text-sm font-bold tracking-tight">
              AI Garage <span className="text-[#5a6170]">· Platform</span>
            </Link>
            <nav className="flex items-center gap-4 text-sm">
              <Link href="/admin" className="text-[#9aa1ad] hover:text-white">
                Overview
              </Link>
              <Link href="/admin/ai" className="text-[#9aa1ad] hover:text-white">
                AI usage
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden font-mono text-xs text-[#5a6170] sm:inline">{user.email}</span>
            <form action={signOutPlatformAdmin}>
              <button
                type="submit"
                className="rounded border border-[#2a2f37] px-2.5 py-1 text-xs text-[#9aa1ad] transition-colors hover:bg-white/[0.04] hover:text-white"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-6">{children}</main>
    </div>
  );
}
