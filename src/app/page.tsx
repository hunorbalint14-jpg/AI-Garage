import Link from "next/link";
import { Car, Bell, Users, ShieldCheck, Zap, MapPin } from "lucide-react";
import { getCurrentTenant } from "@/lib/tenant-data";

/* ── Marketing page (root domain) ─────────────────────── */

const FEATURES = [
  {
    icon: Bell,
    title: "Automated MOT Reminders",
    desc: "Claude AI drafts personalised emails for every vehicle due within 30 days. Set it once — reminders go out every morning.",
  },
  {
    icon: Car,
    title: "Vehicle & MOT Tracking",
    desc: "Full vehicle history per customer. Red/amber due-date indicators so nothing slips through.",
  },
  {
    icon: Users,
    title: "Customer Portal",
    desc: "Your customers log in with a magic link, see their vehicles and MOT status. Branded to your garage.",
  },
  {
    icon: MapPin,
    title: "Multi-Location Support",
    desc: "Each branch gets its own subdomain and customer list. Owners see all locations in one account.",
  },
  {
    icon: ShieldCheck,
    title: "DVLA Integration",
    desc: "Look up any UK registration plate and auto-fill make, model, year, and MOT expiry in seconds.",
  },
  {
    icon: Zap,
    title: "White-Label Branding",
    desc: "Your logo, your colours, your domain. Customers never see Garage-AI — they see your garage.",
  },
];

function MarketingPage() {
  return (
    <div className="min-h-screen bg-[#050c1a] text-white overflow-x-hidden">
      {/* ── Animated background ── */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden>
        <div className="animate-blob animation-delay-0 absolute -top-40 -left-40 h-[600px] w-[600px] rounded-full bg-indigo-900/40 blur-[120px]" />
        <div className="animate-blob animation-delay-2 absolute top-1/3 -right-40 h-[500px] w-[500px] rounded-full bg-blue-900/30 blur-[100px]" />
        <div className="animate-blob animation-delay-4 absolute bottom-0 left-1/3 h-[400px] w-[400px] rounded-full bg-violet-900/25 blur-[80px]" />
        {/* subtle grid */}
        <svg className="absolute inset-0 h-full w-full opacity-[0.04]" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="white" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>
      </div>

      {/* ── Nav ── */}
      <nav className="relative z-10 flex items-center justify-between px-6 py-5 max-w-6xl mx-auto">
        <span className="text-xl font-bold tracking-tight">
          Garage<span className="text-indigo-400">AI</span>
        </span>
        <div className="flex items-center gap-3">
          <Link
            href="/staff/login"
            className="text-sm text-gray-400 hover:text-white transition-colors px-3 py-1.5"
          >
            Staff login
          </Link>
          <Link
            href="/signup"
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium hover:bg-indigo-500 transition-colors"
          >
            Get started free
          </Link>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="relative z-10 flex flex-col items-center text-center px-6 pt-20 pb-32">
        <div className="animate-fade-in-up inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-4 py-1.5 text-sm text-indigo-300 mb-8">
          <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 animate-pulse" />
          AI-powered garage management for UK businesses
        </div>

        <h1
          className="animate-fade-in-up [animation-delay:0.1s] max-w-4xl text-5xl font-extrabold leading-[1.1] tracking-tight sm:text-7xl"
          style={{ animationFillMode: "both" }}
        >
          The smarter way to{" "}
          <span className="animate-gradient-x bg-gradient-to-r from-indigo-400 via-blue-300 to-violet-400 bg-clip-text text-transparent">
            run your garage.
          </span>
        </h1>

        <p
          className="animate-fade-in-up [animation-delay:0.2s] mt-6 max-w-xl text-lg text-gray-400"
          style={{ animationFillMode: "both" }}
        >
          Automated MOT reminders, AI-drafted customer communications, and a
          branded customer portal — built for UK garages from day one.
        </p>

        <div
          className="animate-fade-in-up [animation-delay:0.3s] mt-10 flex flex-wrap justify-center gap-4"
          style={{ animationFillMode: "both" }}
        >
          <Link
            href="/signup"
            className="rounded-xl bg-indigo-600 px-8 py-3.5 text-base font-semibold hover:bg-indigo-500 transition-colors shadow-lg shadow-indigo-900/50"
          >
            Start free trial
          </Link>
          <Link
            href="/staff/login"
            className="rounded-xl border border-white/10 bg-white/5 px-8 py-3.5 text-base font-semibold hover:bg-white/10 transition-colors backdrop-blur-sm"
          >
            Sign in →
          </Link>
        </div>

        {/* Stats strip */}
        <div
          className="animate-fade-in [animation-delay:0.5s] mt-20 flex flex-wrap justify-center gap-12 text-center"
          style={{ animationFillMode: "both" }}
        >
          {[
            { n: "AI", label: "Drafted reminders" },
            { n: "DVLA", label: "MOT auto-lookup" },
            { n: "Multi", label: "Location support" },
          ].map(({ n, label }) => (
            <div key={label}>
              <p className="text-3xl font-bold text-white">{n}</p>
              <p className="mt-1 text-sm text-gray-500">{label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ── */}
      <section className="relative z-10 px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="mb-16 text-center">
            <h2 className="text-3xl font-bold sm:text-4xl">
              Everything your garage needs
            </h2>
            <p className="mt-4 text-gray-400">
              One platform. Every tool. No chasing.
            </p>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, desc }) => (
              <div
                key={title}
                className="group relative rounded-2xl border border-white/5 bg-white/[0.03] p-6 backdrop-blur-sm transition-all hover:border-indigo-500/30 hover:bg-white/[0.06]"
              >
                <div className="animate-shimmer absolute inset-0 rounded-2xl opacity-0 transition-opacity group-hover:opacity-100" />
                <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600/20 text-indigo-400">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="mb-2 font-semibold">{title}</h3>
                <p className="text-sm leading-relaxed text-gray-400">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA band ── */}
      <section className="relative z-10 px-6 py-24">
        <div className="mx-auto max-w-3xl rounded-3xl border border-indigo-500/20 bg-gradient-to-br from-indigo-900/40 to-blue-900/20 px-8 py-16 text-center backdrop-blur-sm">
          <h2 className="text-3xl font-bold sm:text-4xl">
            Ready to modernise your garage?
          </h2>
          <p className="mx-auto mt-4 max-w-md text-gray-300">
            Set up in minutes. No credit card required.
          </p>
          <Link
            href="/signup"
            className="mt-8 inline-block rounded-xl bg-indigo-600 px-10 py-4 text-base font-semibold hover:bg-indigo-500 transition-colors shadow-lg shadow-indigo-900/50"
          >
            Start free trial
          </Link>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="relative z-10 border-t border-white/5 px-6 py-8 text-center text-sm text-gray-600">
        © {new Date().getFullYear()} GarageAI · Built for UK garages
      </footer>
    </div>
  );
}

/* ── Tenant customer-facing page ──────────────────────── */

function TenantPage({
  orgName,
  primaryColor,
  logoUrl,
}: {
  orgName: string;
  primaryColor: string;
  logoUrl: string | null;
}) {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Branded hero */}
      <div
        className="relative overflow-hidden py-24 px-6"
        style={{
          background: `linear-gradient(135deg, ${primaryColor}20 0%, ${primaryColor}08 60%, transparent 100%)`,
          borderBottom: `1px solid ${primaryColor}20`,
        }}
      >
        {/* Decorative blob using brand colour */}
        <div
          className="animate-blob absolute -top-32 -right-32 h-96 w-96 rounded-full blur-[100px] opacity-30"
          style={{ backgroundColor: primaryColor }}
          aria-hidden
        />
        <div
          className="animate-blob animation-delay-4 absolute -bottom-24 -left-24 h-72 w-72 rounded-full blur-[80px] opacity-20"
          style={{ backgroundColor: primaryColor }}
          aria-hidden
        />

        <div className="relative mx-auto flex max-w-2xl flex-col items-center text-center">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt={orgName}
              className="mb-6 h-16 w-auto object-contain"
            />
          ) : (
            <div
              className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl text-2xl font-bold text-white shadow-lg"
              style={{ backgroundColor: primaryColor }}
            >
              {orgName
                .split(/\s+/)
                .map((w) => w[0])
                .join("")
                .toUpperCase()
                .slice(0, 2)}
            </div>
          )}

          <h1 className="text-4xl font-extrabold tracking-tight text-gray-900 sm:text-5xl">
            {orgName}
          </h1>
          <p className="mt-4 text-lg text-gray-500">
            View your vehicles, MOT history, and service schedule.
          </p>

          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link
              href="/login"
              className="rounded-xl px-8 py-3 text-sm font-semibold text-white shadow-lg transition-all hover:opacity-90 active:scale-95"
              style={{ backgroundColor: primaryColor }}
            >
              Sign in
            </Link>
            <Link
              href="/register"
              className="rounded-xl border-2 bg-white px-8 py-3 text-sm font-semibold transition-all hover:bg-gray-50 active:scale-95"
              style={{ borderColor: `${primaryColor}40`, color: primaryColor }}
            >
              Register
            </Link>
          </div>
        </div>
      </div>

      {/* Trust strip */}
      <div className="mx-auto max-w-2xl px-6 py-12">
        <div className="grid grid-cols-3 gap-4 text-center">
          {[
            { icon: ShieldCheck, label: "Secure portal" },
            { icon: Car, label: "Full vehicle history" },
            { icon: Bell, label: "MOT reminders" },
          ].map(({ icon: Icon, label }) => (
            <div
              key={label}
              className="rounded-xl bg-white p-4 shadow-sm border border-gray-100"
            >
              <Icon
                className="mx-auto mb-2 h-5 w-5"
                style={{ color: primaryColor }}
              />
              <p className="text-xs font-medium text-gray-600">{label}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Route entry ──────────────────────────────────────── */

export default async function Home() {
  const tenant = await getCurrentTenant();

  if (!tenant) return <MarketingPage />;

  return (
    <TenantPage
      orgName={tenant.organization.name}
      primaryColor={tenant.organization.primary_color}
      logoUrl={tenant.organization.logo_url}
    />
  );
}
