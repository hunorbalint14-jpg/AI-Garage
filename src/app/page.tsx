import Link from "next/link";
import { Car, Bell, Users, ShieldCheck, Zap, MapPin } from "lucide-react";
import { getCurrentTenant } from "@/lib/tenant-data";
import { AnimatedBackground } from "@/components/animated-background";

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
    desc: "Your logo, your colours, your domain. Customers never see AI Garage — they see your garage.",
  },
];

function MarketingPage() {
  return (
    <div className="min-h-screen bg-[#0b0d11] text-white overflow-x-hidden">
      <AnimatedBackground />

      <nav className="relative z-10 flex items-center justify-between px-6 py-5 max-w-6xl mx-auto">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/logo/aigarage-logo-horizontal-on-dark.svg" alt="AI Garage" className="h-8 w-auto" />
        <div className="flex items-center gap-3">
          <Link
            href="/staff/login"
            className="text-sm text-gray-400 hover:text-white transition-colors px-3 py-1.5"
          >
            Staff login
          </Link>
          <Link
            href="/signup"
            className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium hover:bg-green-500 transition-colors"
          >
            Get started free
          </Link>
        </div>
      </nav>

      <section className="relative z-10 flex flex-col items-center text-center px-6 pt-20 pb-32">
        <div className="animate-fade-in-up inline-flex items-center gap-2 rounded-full border border-green-500/30 bg-green-500/10 px-4 py-1.5 text-sm text-green-300 mb-8">
          <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
          AI-powered garage management for UK businesses
        </div>

        <h1 className="animate-fade-in-up max-w-4xl text-5xl font-extrabold leading-[1.1] tracking-tight sm:text-7xl" style={{ animationDelay: "0.1s", animationFillMode: "both" }}>
          The smarter way to{" "}
          <span className="animate-gradient-x bg-gradient-to-r from-green-300 via-emerald-300 to-lime-400 bg-clip-text text-transparent">
            run your garage.
          </span>
        </h1>

        <p className="animate-fade-in-up mt-6 max-w-xl text-lg text-gray-400" style={{ animationDelay: "0.2s", animationFillMode: "both" }}>
          Automated MOT reminders, AI-drafted customer communications, and a branded customer portal — built for UK garages from day one.
        </p>

        <div className="animate-fade-in-up mt-10 flex flex-wrap justify-center gap-4" style={{ animationDelay: "0.3s", animationFillMode: "both" }}>
          <Link href="/signup" className="rounded-xl bg-green-600 px-8 py-3.5 text-base font-semibold hover:bg-green-500 transition-colors shadow-lg shadow-green-900/50">
            Start free trial
          </Link>
          <Link href="/staff/login" className="rounded-xl border border-white/10 bg-white/5 px-8 py-3.5 text-base font-semibold hover:bg-white/10 transition-colors backdrop-blur-sm">
            Sign in →
          </Link>
        </div>

        <div className="animate-fade-in mt-20 flex flex-wrap justify-center gap-12 text-center" style={{ animationDelay: "0.5s", animationFillMode: "both" }}>
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

      <section className="relative z-10 px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="mb-16 text-center">
            <h2 className="text-3xl font-bold sm:text-4xl">Everything your garage needs</h2>
            <p className="mt-4 text-gray-400">One platform. Every tool. No chasing.</p>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="group relative rounded-2xl border border-white/5 bg-white/[0.03] p-6 backdrop-blur-sm transition-all hover:border-green-500/30 hover:bg-white/[0.06]">
                <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-green-600/20 text-green-400">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="mb-2 font-semibold">{title}</h3>
                <p className="text-sm leading-relaxed text-gray-400">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="relative z-10 px-6 py-24">
        <div className="mx-auto max-w-3xl rounded-3xl border border-green-500/20 bg-gradient-to-br from-green-900/40 to-emerald-900/20 px-8 py-16 text-center backdrop-blur-sm">
          <h2 className="text-3xl font-bold sm:text-4xl">Ready to modernise your garage?</h2>
          <p className="mx-auto mt-4 max-w-md text-gray-300">Set up in minutes. No credit card required.</p>
          <Link href="/signup" className="mt-8 inline-block rounded-xl bg-green-600 px-10 py-4 text-base font-semibold hover:bg-green-500 transition-colors shadow-lg shadow-green-900/50">
            Start free trial
          </Link>
        </div>
      </section>

      <footer className="relative z-10 border-t border-white/5 px-6 py-8 text-center text-sm text-gray-600">
        © {new Date().getFullYear()} AI Garage · Built for UK garages
      </footer>
    </div>
  );
}

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
    <div className="min-h-screen bg-[#0b0d11] text-white overflow-x-hidden">
      <AnimatedBackground brandColor={primaryColor} />

      <nav className="relative z-10 flex items-center justify-between px-6 py-5 max-w-6xl mx-auto">
        <div className="flex items-center gap-3">
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
        </div>
        <Link
          href="/login"
          className="text-sm text-gray-300 hover:text-white transition-colors px-3 py-1.5"
        >
          Sign in →
        </Link>
      </nav>

      <section className="relative z-10 flex flex-col items-center text-center px-6 pt-20 pb-32">
        <div
          className="animate-fade-in-up inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm mb-8 backdrop-blur-sm"
          style={{
            borderColor: `${primaryColor}50`,
            backgroundColor: `${primaryColor}15`,
            color: "#fff",
          }}
        >
          <span
            className="h-1.5 w-1.5 rounded-full animate-pulse"
            style={{ backgroundColor: primaryColor }}
          />
          Customer portal
        </div>

        <h1
          className="animate-fade-in-up max-w-3xl text-5xl font-extrabold leading-[1.1] tracking-tight sm:text-6xl"
          style={{ animationDelay: "0.1s", animationFillMode: "both" }}
        >
          Welcome to{" "}
          <span style={{ color: primaryColor }}>{orgName}</span>
        </h1>

        <p
          className="animate-fade-in-up mt-6 max-w-xl text-lg text-gray-400"
          style={{ animationDelay: "0.2s", animationFillMode: "both" }}
        >
          View your vehicles, MOT history, and service schedule. Get reminders automatically when something is due.
        </p>

        <div
          className="animate-fade-in-up mt-10 flex flex-wrap justify-center gap-4"
          style={{ animationDelay: "0.3s", animationFillMode: "both" }}
        >
          <Link
            href="/login"
            className="rounded-xl px-8 py-3.5 text-base font-semibold text-white transition-opacity hover:opacity-90 shadow-lg"
            style={{ backgroundColor: primaryColor, boxShadow: `0 12px 24px -8px ${primaryColor}60` }}
          >
            Sign in
          </Link>
          <Link
            href="/register"
            className="rounded-xl border border-white/10 bg-white/5 px-8 py-3.5 text-base font-semibold hover:bg-white/10 transition-colors backdrop-blur-sm"
          >
            Create account
          </Link>
        </div>

        <div
          className="animate-fade-in mt-20 grid grid-cols-3 gap-6 max-w-2xl w-full"
          style={{ animationDelay: "0.5s", animationFillMode: "both" }}
        >
          {[
            { icon: ShieldCheck, label: "Secure portal" },
            { icon: Car, label: "Full vehicle history" },
            { icon: Bell, label: "Auto reminders" },
          ].map(({ icon: Icon, label }) => (
            <div
              key={label}
              className="rounded-xl border border-white/5 bg-white/[0.03] p-4 text-center backdrop-blur-sm"
            >
              <Icon className="mx-auto mb-2 h-5 w-5" style={{ color: primaryColor }} />
              <p className="text-xs text-gray-400">{label}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

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
