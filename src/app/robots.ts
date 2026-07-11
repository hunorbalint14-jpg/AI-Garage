import type { MetadataRoute } from "next";
import { getCurrentTenant } from "@/lib/tenant-data";
import { tenantBaseUrl } from "@/lib/minisite-seo";

// Tenant-aware robots (#507 PR 3). Staff, portal and token-gated routes stay
// out of the index everywhere; the sitemap URL follows the host.

export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const tenant = await getCurrentTenant();
  const root = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "ai-garage.co.uk";
  const base = tenant ? tenantBaseUrl(tenant.organization.slug) : `https://${root}`;
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/staff", "/dashboard", "/api/", "/quote/", "/invoice/", "/pay/", "/authorise/", "/review/", "/confirm/"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
