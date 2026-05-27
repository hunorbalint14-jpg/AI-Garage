import { type PermissionKey, HARD_OWNER_ADMIN_PERMS } from "@/app/staff/staff-members/constants";
import type { StaffContext } from "@/lib/staff-context";

export class PermissionDeniedError extends Error {
  public readonly permission: PermissionKey;
  constructor(key: PermissionKey) {
    super(`Permission denied: ${key}`);
    this.name = "PermissionDeniedError";
    this.permission = key;
  }
}

export function hasPermission(ctx: StaffContext, key: PermissionKey): boolean {
  // Owners + admins bypass location-level perms, except for hard-locked
  // sensitive permissions which still require org-level access (they always
  // get those by virtue of being owner/admin, but if we ever loosen orgRole
  // gating elsewhere this stays correct).
  if (ctx.orgRole === "owner" || ctx.orgRole === "admin") return true;

  // Hard-locked perms can only be granted via orgRole — never via template.
  if (HARD_OWNER_ADMIN_PERMS.includes(key)) return false;

  return ctx.locationPermissions?.[key] === true;
}

export function requirePermission(ctx: StaffContext, key: PermissionKey): void {
  if (!hasPermission(ctx, key)) throw new PermissionDeniedError(key);
}

export function canAccessMot(ctx: StaffContext): boolean {
  return ctx.orgRole != null || ctx.motTester === true || ctx.motQcReviewer === true;
}

// Returns an { ok:false, error } payload from a server action when perm fails.
// Lets callers do: `try { requirePermission(...); ... } catch (e) { return denied(e); }`.
export function denied(err: unknown): { ok: false; error: string } {
  if (err instanceof PermissionDeniedError) {
    return { ok: false, error: `forbidden:${err.permission}` };
  }
  throw err;
}
