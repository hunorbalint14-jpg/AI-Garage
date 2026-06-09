import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";
import { createClient } from "@/lib/supabase/server";
import { isPlatformAdminUser } from "@/lib/platform-admin";
import { fetchAdminStatusSummary, type AdminStatusSummary } from "@/lib/platform/reliability";
import { AdminNav } from "@/components/admin/admin-nav";
import { AdminTopbar } from "@/components/admin/admin-topbar";
import { signOutPlatformAdmin } from "./login/actions";

// Design fonts (scoped to /admin only via the wrapper's CSS variables — the
// rest of the app keeps its own font stack). The handoff uses Space Grotesk for
// UI text and JetBrains Mono for numbers/identifiers.
const sans = Space_Grotesk({ subsets: ["latin"], variable: "--font-admin-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-admin-mono" });
const fontVars = `${sans.variable} ${mono.variable}`;
// Remap the Tailwind font tokens inside the shell so font-sans/font-mono pick up
// the design fonts here without touching the global theme. globals.css uses
// `@theme inline`, so font-sans → var(--font-sans) and font-mono →
// var(--font-geist-mono); override exactly those within the subtree.
const fontScope = { "--font-sans": "var(--font-admin-sans)", "--font-geist-mono": "var(--font-admin-mono)" } as React.CSSProperties;

const STATUS_META: Record<AdminStatusSummary["status"], { label: string; dot: string; box: string }> = {
  operational: { label: "All systems operational", dot: "bg-[#5fdd9d]", box: "border-[#2a5a3a] bg-gradient-to-b from-[#13301f] to-[#171b21]" },
  degraded: { label: "Partial degradation", dot: "bg-[#f5c451]", box: "border-[#5a4a1f] bg-gradient-to-b from-[#2e2410] to-[#171b21]" },
  down: { label: "Major incident", dot: "bg-[#ff7b7b]", box: "border-[#5a2424] bg-gradient-to-b from-[#3a1a1a] to-[#171b21]" },
};

function statusPageUrl(): string {
  const root = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? process.env.ROOT_DOMAIN ?? "ai-garage.co.uk";
  const host = root.split(":")[0];
  const proto = host === "localhost" || host.endsWith("localtest.me") || host.endsWith(".local") ? "http" : "https";
  return `${proto}://${root}/status`;
}

// The platform-operator dashboard reads across ALL tenants via the service-role
// client, so this layout is the single access gate for every /admin/* route:
//   1. must be reached via the reserved admin host (x-platform-host header);
//   2. must be an authenticated user;
//   3. that user's email must be in the PLATFORM_ADMIN_EMAILS allowlist.
// The /admin/login route is exempt from (2)/(3) so the gate can't loop.
//
// Nav active state + topbar title are computed client-side (AdminNav /
// AdminTopbar) because this layout does NOT re-render on client-side navigation
// between admin pages — a server-derived active state would freeze.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const h = await headers();
  if (h.get("x-platform-host") !== "1") notFound();

  const pathname = h.get("x-pathname") ?? "";
  const isLoginRoute = pathname.startsWith("/admin/login");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const allowed = await isPlatformAdminUser(user);

  if (isLoginRoute) {
    // Already a valid operator? Skip the login screen.
    if (user && allowed) redirect("/admin");
    return (
      <div className={`${fontVars} min-h-screen bg-[#0f1115] font-sans text-[#e6e8eb]`} style={fontScope}>
        {children}
      </div>
    );
  }

  if (!user) redirect("/admin/login");
  if (!allowed) notFound();

  const summary = await fetchAdminStatusSummary();
  const sm = STATUS_META[summary.status];

  return (
    <div
      className={`${fontVars} grid h-screen grid-cols-1 overflow-hidden bg-[#0f1115] font-sans text-[#e6e8eb] lg:grid-cols-[236px_1fr]`}
      style={fontScope}
    >
      {/* Sidebar */}
      <aside className="hidden min-w-0 flex-col gap-3.5 border-r border-[#23272f] bg-[#15181d] p-4 lg:flex">
        <Link href="/admin" className="flex items-center gap-2.5 px-1.5 py-1">
          <span className="flex h-[30px] w-[30px] items-center justify-center rounded-[7px] bg-[#171b21] ring-1 ring-[#23272f]">
            <svg viewBox="0 0 100 100" className="h-[22px] w-[22px]" aria-hidden>
              <path d="M18 52 H38 L44 38 L52 66 L58 50 H82" fill="none" stroke="#22c55e" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="82" cy="50" r="5" fill="#22c55e" />
            </svg>
          </span>
          <span className="flex flex-col leading-tight">
            <span className="text-sm font-bold tracking-tight">AI Garage</span>
            <span className="mt-0.5 text-[10.5px] font-medium tracking-wide text-[#5a6170]">Platform · Operations</span>
          </span>
        </Link>

        {/* Global status */}
        <div className={`flex items-center gap-2.5 rounded-lg border px-2.5 py-2.5 ${sm.box}`}>
          <span className={`h-2 w-2 shrink-0 rounded-full ${sm.dot}`} />
          <div className="min-w-0">
            <div className="text-[12px] font-semibold leading-tight">{sm.label}</div>
            <div className="mt-0.5 text-[10.5px] text-[#9aa1ad]">
              {summary.tenantsHealthy}/{summary.tenantsTotal} tenants healthy
            </div>
          </div>
        </div>

        <AdminNav activeIncidents={summary.activeIncidents} />

        {/* Footer */}
        <div className="mt-auto border-t border-[#23272f] px-1 pt-3">
          <div className="truncate font-mono text-[11px] text-[#9aa1ad]">{user.email}</div>
          <div className="mt-0.5 font-mono text-[9.5px] tracking-[0.08em] text-[#5a6170]">PLATFORM_ADMIN</div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-h-0 min-w-0 flex-col">
        <AdminTopbar statusUrl={statusPageUrl()} statusDot={sm.dot}>
          <form action={signOutPlatformAdmin}>
            <button
              type="submit"
              className="rounded-lg border border-[#2a2f37] px-2.5 py-1.5 text-xs text-[#9aa1ad] transition-colors hover:bg-white/[0.04] hover:text-white"
            >
              Sign out
            </button>
          </form>
        </AdminTopbar>
        <main className="min-h-0 flex-1 overflow-y-auto p-[18px]">{children}</main>
      </div>
    </div>
  );
}
