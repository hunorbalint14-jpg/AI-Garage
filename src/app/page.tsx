import Link from "next/link";
import { Car, Bell, ShieldCheck } from "lucide-react";
import { getCurrentTenant } from "@/lib/tenant-data";
import { AnimatedBackground } from "@/components/animated-background";
import { MarketingLandingPage } from "@/components/marketing/landing-page";
import { loadMiniSite } from "@/lib/minisite-data";
import { MiniSitePage } from "@/components/minisite/mini-site";
import { siteTitle, siteDescription, tenantBaseUrl } from "@/lib/minisite-seo";
import type { Metadata } from "next";

// Tenant metadata (#507 PR 3): published orgs get real local-business
// metadata + canonical; unpublished tenant splashes are noindexed; the apex
// marketing page inherits the layout defaults untouched.
export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getCurrentTenant();
  if (!tenant) return {};
  const site = await loadMiniSite(tenant.organization.id);
  if (!site) return { robots: { index: false, follow: false } };
  const base = tenantBaseUrl(site.org.slug);
  const title = siteTitle(site);
  const description = siteDescription(site);
  return {
    title,
    description,
    alternates: { canonical: `${base}/` },
    openGraph: { title, description, url: `${base}/`, type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
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
  if (!tenant) return <MarketingLandingPage />;

  // Garage mini-site (#507): published orgs get the full marketing page;
  // everyone else keeps the splash below, unchanged.
  const site = await loadMiniSite(tenant.organization.id);
  if (site) return <MiniSitePage site={site} />;

  return (
    <TenantPage
      orgName={tenant.organization.name}
      primaryColor={tenant.organization.primary_color}
      logoUrl={tenant.organization.logo_url}
    />
  );
}
