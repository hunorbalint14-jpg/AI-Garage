const ROOT_DOMAIN =
  process.env.ROOT_DOMAIN ??
  process.env.NEXT_PUBLIC_ROOT_DOMAIN ??
  "garage-ai.local:3000";

// Vercel preview deployments are served from `<project>-<hash>-<scope>.vercel.app`
// — a subdomain of vercel.app, not of our ROOT_DOMAIN — so tenant resolution
// from host fails and the app falls through to the landing page. Setting
// PREVIEW_TENANT_SLUG (preview env only) pins a single tenant so previews
// render that garage's pages. Never set this in Production.
const PREVIEW_TENANT_SLUG = process.env.PREVIEW_TENANT_SLUG?.trim() || null;

export type TenantContext = {
  slug: string | null;
  isRootDomain: boolean;
  // The reserved `admin.<root>` host — the platform-operator dashboard. Never a
  // tenant; access is further gated by the email allowlist in the /admin layout.
  isPlatformAdminHost: boolean;
};

export function resolveTenantFromHost(host: string | null): TenantContext {
  const fromHost = resolveFromHostStrict(host);
  if (fromHost.slug || fromHost.isPlatformAdminHost) return fromHost;
  // Fall back to the preview pin only when host failed to identify a tenant.
  if (PREVIEW_TENANT_SLUG) return { slug: PREVIEW_TENANT_SLUG, isRootDomain: false, isPlatformAdminHost: false };
  return fromHost;
}

function resolveFromHostStrict(host: string | null): TenantContext {
  if (!host) return { slug: null, isRootDomain: true, isPlatformAdminHost: false };

  const hostname = host.split(":")[0];
  const rootHostname = ROOT_DOMAIN.split(":")[0];

  // Reserved operator subdomain — checked before generic subdomain extraction
  // so it is never treated as a tenant slug.
  if (hostname === `admin.${rootHostname}`) {
    return { slug: null, isRootDomain: false, isPlatformAdminHost: true };
  }

  if (hostname === rootHostname || hostname === `www.${rootHostname}`) {
    return { slug: null, isRootDomain: true, isPlatformAdminHost: false };
  }

  if (!hostname.endsWith(`.${rootHostname}`)) {
    return { slug: null, isRootDomain: true, isPlatformAdminHost: false };
  }

  const slug = hostname.slice(0, -1 * (rootHostname.length + 1));
  return { slug: slug || null, isRootDomain: !slug, isPlatformAdminHost: false };
}
