const ROOT_DOMAIN =
  process.env.ROOT_DOMAIN ??
  process.env.NEXT_PUBLIC_ROOT_DOMAIN ??
  "garage-ai.local:3000";

export type TenantContext = {
  slug: string | null;
  isRootDomain: boolean;
};

export function resolveTenantFromHost(host: string | null): TenantContext {
  if (!host) return { slug: null, isRootDomain: true };

  const hostname = host.split(":")[0];
  const rootHostname = ROOT_DOMAIN.split(":")[0];

  if (hostname === rootHostname || hostname === `www.${rootHostname}`) {
    return { slug: null, isRootDomain: true };
  }

  if (!hostname.endsWith(`.${rootHostname}`)) {
    return { slug: null, isRootDomain: true };
  }

  const slug = hostname.slice(0, -1 * (rootHostname.length + 1));
  return { slug: slug || null, isRootDomain: !slug };
}

export function buildTenantUrl(slug: string): string {
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localtest.me:3000";
  const host = rootDomain.split(":")[0];
  const isLocal =
    host === "localtest.me" || host.endsWith(".local") || host === "localhost";
  return `${isLocal ? "http" : "https"}://${slug}.${rootDomain}`;
}
