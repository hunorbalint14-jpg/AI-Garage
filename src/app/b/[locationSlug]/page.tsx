import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentTenant } from "@/lib/tenant-data";
import { loadMiniSite } from "@/lib/minisite-data";
import { MiniSitePage } from "@/components/minisite/mini-site";
import { siteDescription, tenantBaseUrl } from "@/lib/minisite-seo";

// Per-branch page (#507 PR 3) — multi-location orgs only; each branch gets
// its own indexable page + AutoRepair block. Single-location orgs 404 here
// (the root IS the branch page).

export const dynamic = "force-dynamic";

async function branchSite(locationSlug: string) {
  const tenant = await getCurrentTenant();
  if (!tenant) return null;
  const site = await loadMiniSite(tenant.organization.id);
  if (!site || site.branches.length < 2) return null;
  const branch = site.branches.find((b) => b.slug === locationSlug);
  if (!branch) return null;
  // Scope the page to this branch: its hours/services/address only.
  return { site: { ...site, branches: [branch] }, branch };
}

export async function generateMetadata({ params }: { params: Promise<{ locationSlug: string }> }): Promise<Metadata> {
  const { locationSlug } = await params;
  const scoped = await branchSite(locationSlug);
  if (!scoped) return { robots: { index: false, follow: false } };
  const base = tenantBaseUrl(scoped.site.org.slug);
  const title = `${scoped.branch.name} — MOT, Servicing & Repairs`;
  const description = siteDescription(scoped.site);
  return {
    title,
    description,
    alternates: { canonical: `${base}/b/${scoped.branch.slug}` },
    openGraph: { title, description, url: `${base}/b/${scoped.branch.slug}`, type: "website" },
  };
}

export default async function BranchPage({ params }: { params: Promise<{ locationSlug: string }> }) {
  const { locationSlug } = await params;
  const scoped = await branchSite(locationSlug);
  if (!scoped) notFound();
  return <MiniSitePage site={scoped.site} />;
}
