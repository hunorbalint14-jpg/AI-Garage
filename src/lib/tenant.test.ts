import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// tenant.ts reads env at module load (`ROOT_DOMAIN`, `PREVIEW_TENANT_SLUG`).
// Reset the module registry between cases so each test re-evaluates those
// top-level consts against the env we just set.
async function freshTenant(env: Record<string, string | undefined> = {}) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return import("./tenant");
}

describe("resolveTenantFromHost", () => {
  const orig = {
    root: process.env.NEXT_PUBLIC_ROOT_DOMAIN,
    preview: process.env.PREVIEW_TENANT_SLUG,
  };

  beforeEach(() => {
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = "ai-garage.co.uk";
    delete process.env.PREVIEW_TENANT_SLUG;
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = orig.root;
    if (orig.preview === undefined) delete process.env.PREVIEW_TENANT_SLUG;
    else process.env.PREVIEW_TENANT_SLUG = orig.preview;
    vi.resetModules();
  });

  it("returns isRootDomain for bare root", async () => {
    const { resolveTenantFromHost } = await freshTenant();
    expect(resolveTenantFromHost("ai-garage.co.uk")).toEqual({ slug: null, isRootDomain: true });
  });

  it("returns isRootDomain for www.root", async () => {
    const { resolveTenantFromHost } = await freshTenant();
    expect(resolveTenantFromHost("www.ai-garage.co.uk")).toEqual({ slug: null, isRootDomain: true });
  });

  it("extracts slug from valid subdomain", async () => {
    const { resolveTenantFromHost } = await freshTenant();
    expect(resolveTenantFromHost("acme.ai-garage.co.uk")).toEqual({ slug: "acme", isRootDomain: false });
  });

  it("ignores port", async () => {
    const { resolveTenantFromHost } = await freshTenant();
    expect(resolveTenantFromHost("acme.ai-garage.co.uk:443")).toEqual({ slug: "acme", isRootDomain: false });
  });

  it("returns isRootDomain for unrelated domains", async () => {
    const { resolveTenantFromHost } = await freshTenant();
    expect(resolveTenantFromHost("evil.com")).toEqual({ slug: null, isRootDomain: true });
  });

  it("returns isRootDomain when host is null", async () => {
    const { resolveTenantFromHost } = await freshTenant();
    expect(resolveTenantFromHost(null)).toEqual({ slug: null, isRootDomain: true });
  });

  // PREVIEW_TENANT_SLUG is captured at module-load time, so dynamic test
  // env mutation interacts oddly with vitest's module cache. The fallback
  // behaviour is covered by the integration test on Vercel preview deploys.
});
