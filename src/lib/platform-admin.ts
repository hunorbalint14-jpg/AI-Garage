// Platform-operator allowlist. The admin dashboard reads across ALL tenants, so
// access is gated by both the admin subdomain AND membership of this list. The
// list is an env var (PLATFORM_ADMIN_EMAILS, comma-separated) — no DB table in
// v1, so adding/removing an operator is a deploy-time change.

export function platformAdminEmails(): Set<string> {
  const raw = process.env.PLATFORM_ADMIN_EMAILS ?? "";
  return new Set(
    raw
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0),
  );
}

// Whether the given email is a platform operator. Case-insensitive; null/empty
// emails and an unconfigured allowlist both return false (deny by default).
export function isPlatformAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  return platformAdminEmails().has(email.trim().toLowerCase());
}
