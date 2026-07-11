import type { MetadataRoute } from "next";
import { getCurrentTenant } from "@/lib/tenant-data";
import { loadMiniSite } from "@/lib/minisite-data";
import { tenantBaseUrl } from "@/lib/minisite-seo";

// Tenant-aware sitemap (#507 PR 3): a published org lists its mini-site,
// branch pages and the booking page. Unpublished tenants and the apex return
// only the booking page / marketing root respectively.

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const tenant = await getCurrentTenant();
  if (!tenant) {
    const root = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "ai-garage.co.uk";
    return [{ url: `https://${root}/`, changeFrequency: "weekly", priority: 1 }];
  }

  const base = tenantBaseUrl(tenant.organization.slug);
  const site = await loadMiniSite(tenant.organization.id);
  if (!site) return [{ url: `${base}/book`, changeFrequency: "weekly", priority: 0.8 }];

  const entries: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/book`, changeFrequency: "weekly", priority: 0.9 },
  ];
  if (site.branches.length > 1) {
    for (const b of site.branches) {
      entries.push({ url: `${base}/b/${b.slug}`, changeFrequency: "weekly", priority: 0.7 });
    }
  }
  return entries;
}
