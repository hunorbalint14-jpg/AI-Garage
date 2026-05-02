const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])?$/;

const RESERVED_SLUGS = new Set([
  "www",
  "app",
  "api",
  "admin",
  "auth",
  "staff",
  "login",
  "signup",
  "dashboard",
  "settings",
  "support",
  "help",
  "blog",
  "docs",
  "status",
  "mail",
  "ftp",
  "test",
  "dev",
  "staging",
  "prod",
  "production",
  "garage-ai",
]);

export function validateSlug(input: string): string | null {
  const slug = input.trim().toLowerCase();
  if (!slug) return "Subdomain is required.";
  if (slug.length < 3) return "Subdomain must be at least 3 characters.";
  if (slug.length > 30) return "Subdomain must be 30 characters or less.";
  if (!SLUG_RE.test(slug)) {
    return "Use lowercase letters, numbers, and hyphens. Must start and end with a letter or number.";
  }
  if (RESERVED_SLUGS.has(slug)) return "That subdomain is reserved.";
  return null;
}
