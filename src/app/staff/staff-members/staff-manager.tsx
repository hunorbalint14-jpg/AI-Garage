"use client";

import { useState, useTransition } from "react";
import {
  inviteStaffMember,
  updateStaffPermissions,
  updateStaffRole,
  removeStaffMember,
  resetStaffPassword,
  resetStaffMfa,
  setStaffPassword,
} from "./actions";
import { type Permissions, DEFAULT_PERMISSIONS } from "./constants";
import type { StaffEntry, LocationOption } from "./page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const PERM_LABELS: { key: keyof Permissions; label: string; desc: string }[] = [
  { key: "bookings", label: "Bookings", desc: "Create, edit, cancel bookings" },
  { key: "customers", label: "Customers", desc: "Add and manage customer records" },
  { key: "reminders", label: "Reminders", desc: "Send messages and reminders" },
  { key: "revenue", label: "Revenue", desc: "View invoices and financial data" },
  { key: "campaigns", label: "Campaigns", desc: "Send bulk marketing messages" },
  { key: "services", label: "Services", desc: "Configure service catalogue" },
  { key: "bays", label: "Bays", desc: "Set up and manage workshop bays" },
  { key: "staff", label: "Manage staff", desc: "Invite and remove team members" },
  { key: "automations", label: "Automations", desc: "Configure automated workflows" },
];

function PermDot({ active }: { active: boolean }) {
  return (
    <span
      title={active ? "Enabled" : "Disabled"}
      className={`inline-block h-2 w-2 rounded-full ${active ? "bg-green-500" : "bg-muted"}`}
    />
  );
}

function RoleBadge({ role }: { role: string }) {
  const styles: Record<string, string> = {
    owner: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
    admin: "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300",
    manager: "bg-purple-100 text-purple-800 dark:bg-purple-950/40 dark:text-purple-300",
    staff: "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={`rounded px-2 py-0.5 text-xs font-medium capitalize ${styles[role] ?? styles.staff}`}
    >
      {role}
    </span>
  );
}

function PermissionsGrid({
  perms,
  onChange,
  disabled,
}: {
  perms: Permissions;
  onChange: (p: Permissions) => void;
  disabled: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {PERM_LABELS.map(({ key, label, desc }) => (
        <label
          key={key}
          className="flex items-start gap-2.5 rounded-md border p-2.5 cursor-pointer hover:bg-muted/40 transition-colors"
        >
          <input
            type="checkbox"
            checked={perms[key]}
            onChange={(e) => onChange({ ...perms, [key]: e.target.checked })}
            disabled={disabled}
            className="mt-0.5 shrink-0"
          />
          <div>
            <p className="text-sm font-medium leading-none">{label}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
          </div>
        </label>
      ))}
    </div>
  );
}

type InviteFormState = {
  email: string;
  fullName: string;
  scope: "org" | "location";
  locationId: string;
  role: string;
  permissions: Permissions;
};

export function StaffManager({
  entries,
  locations,
  currentUserId,
  isOwner,
}: {
  entries: StaffEntry[];
  locations: LocationOption[];
  currentUserId: string;
  isOwner: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [resetLink, setResetLink] = useState<{ email: string; link: string } | null>(null);
  const [setPasswordFor, setSetPasswordFor] = useState<{ userId: string; name: string } | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editPerms, setEditPerms] = useState<Permissions | null>(null);
  const [editRole, setEditRole] = useState<string>("");

  const [invite, setInvite] = useState<InviteFormState>({
    email: "",
    fullName: "",
    scope: "location",
    locationId: locations[0]?.id ?? "",
    role: "staff",
    permissions: DEFAULT_PERMISSIONS.staff,
  });

  function flash(msg: string) {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 3000);
  }

  function copyText(text: string) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
    flash("Copied to clipboard.");
  }

  function fallbackCopy(text: string) {
    const el = document.createElement("textarea");
    el.value = text;
    el.style.cssText = "position:fixed;opacity:0;top:0;left:0";
    document.body.appendChild(el);
    el.focus();
    el.select();
    document.execCommand("copy");
    document.body.removeChild(el);
  }

  function handleRoleChange(role: string) {
    const perms = DEFAULT_PERMISSIONS[role] ?? DEFAULT_PERMISSIONS.staff;
    setInvite((prev) => ({ ...prev, role, permissions: perms }));
  }

  function handleInviteSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData();
    formData.set("email", invite.email);
    formData.set("fullName", invite.fullName);
    formData.set("scope", invite.scope);
    formData.set("locationId", invite.locationId);
    formData.set("role", invite.role);
    for (const [k, v] of Object.entries(invite.permissions)) {
      if (v) formData.set(`perm_${k}`, "on");
    }
    startTransition(async () => {
      const result = await inviteStaffMember(formData);
      if ("error" in result) {
        setError(result.error);
      } else {
        setShowInvite(false);
        setInviteLink(result.inviteLink);
        setInvite({
          email: "",
          fullName: "",
          scope: "location",
          locationId: locations[0]?.id ?? "",
          role: "staff",
          permissions: DEFAULT_PERMISSIONS.staff,
        });
      }
    });
  }

  function handleResetLogin(email: string) {
    setError(null);
    setResetLink(null);
    startTransition(async () => {
      const result = await resetStaffPassword(email);
      if ("error" in result) setError(result.error);
      else setResetLink({ email, link: result.link });
    });
  }

  function handleSetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!setPasswordFor) return;
    setError(null);
    startTransition(async () => {
      const result = await setStaffPassword(setPasswordFor.userId, newPassword);
      if ("error" in result) setError(result.error);
      else {
        flash(`Password set for ${setPasswordFor.name}.`);
        setSetPasswordFor(null);
        setNewPassword("");
      }
    });
  }

  function handleResetMfa(userId: string, name: string) {
    if (!confirm(`Reset MFA for ${name}? They will need to re-enrol next login.`)) return;
    setError(null);
    startTransition(async () => {
      const result = await resetStaffMfa(userId);
      if ("error" in result) setError(result.error);
      else flash(`MFA reset for ${name}.`);
    });
  }

  function startEdit(userId: string, locationId: string, currentPerms: Permissions, currentRole: string) {
    setEditingKey(`${userId}|${locationId}`);
    setEditPerms({ ...currentPerms });
    setEditRole(currentRole);
    setError(null);
  }

  function cancelEdit() {
    setEditingKey(null);
    setEditPerms(null);
    setEditRole("");
  }

  function saveEdit(userId: string, locationId: string) {
    if (!editPerms) return;
    setError(null);
    startTransition(async () => {
      const [permResult, roleResult] = await Promise.all([
        updateStaffPermissions(userId, locationId, editPerms),
        updateStaffRole(userId, locationId, editRole),
      ]);
      const err = ("error" in permResult ? permResult.error : null) ?? ("error" in roleResult ? roleResult.error : null);
      if (err) { setError(err); return; }
      flash("Staff updated.");
      cancelEdit();
    });
  }

  function handleRemove(userId: string, locationId: string | null, name: string) {
    if (!confirm(`Remove ${name} from ${locationId ? "this location" : "the organisation"}?`)) return;
    setError(null);
    startTransition(async () => {
      const result = await removeStaffMember(userId, locationId);
      if ("error" in result) setError(result.error);
      else flash("Staff member removed.");
    });
  }

  const inputClass =
    "w-full rounded-md border border-black/20 dark:border-white/25 bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";

  return (
    <div className="flex flex-col gap-4">
      {/* Staff list */}
      <div className="rounded-lg border overflow-hidden">
        {/* Table header */}
        <div className="bg-muted/50 grid grid-cols-[1fr_100px_160px_auto] gap-4 px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
          <span>Staff member</span>
          <span>Role</span>
          <span>Permissions</span>
          <span />
        </div>

        {entries.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No staff found. Invite your first team member below.
          </div>
        )}

        {entries.map((entry) => {
          const displayName = entry.fullName ?? entry.email;
          const isOrg = !!entry.orgRole;

          // Org-level row
          if (isOrg) {
            return (
              <div key={`org-${entry.userId}`} className="border-t">
                <div className="grid grid-cols-[1fr_100px_160px_auto] gap-4 px-4 py-3 items-center">
                  <div>
                    <p className="text-sm font-medium">
                      {displayName}
                      {entry.isCurrentUser && (
                        <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">{entry.email}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">All locations</p>
                  </div>
                  <div>
                    <RoleBadge role={entry.orgRole!} />
                  </div>
                  <div className="flex flex-wrap gap-1.5 items-center">
                    <span className="text-xs text-muted-foreground">Full access</span>
                    {entry.hasMfa ? (
                      <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400">MFA on</span>
                    ) : (
                      <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground">No MFA</span>
                    )}
                  </div>
                  <div className="flex gap-1.5 justify-end flex-wrap">
                    {!entry.isCurrentUser && (
                      <>
                        <Button variant="outline" size="xs" disabled={pending} onClick={() => { setSetPasswordFor({ userId: entry.userId, name: displayName }); setNewPassword(""); }}>
                          Set password
                        </Button>
                        <Button variant="outline" size="xs" disabled={pending} onClick={() => handleResetLogin(entry.email)}>
                          Reset login
                        </Button>
                        {entry.hasMfa && (
                          <Button variant="outline" size="xs" disabled={pending} onClick={() => handleResetMfa(entry.userId, displayName)}>
                            Reset MFA
                          </Button>
                        )}
                      </>
                    )}
                    {isOwner && entry.orgRole !== "owner" && !entry.isCurrentUser && (
                      <Button variant="destructive" size="xs" disabled={pending} onClick={() => handleRemove(entry.userId, null, displayName)}>
                        Remove
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          }

          // Location-level rows (one per location)
          return entry.locationEntries.map((loc) => {
            const key = `${entry.userId}|${loc.locationId}`;
            const isEditing = editingKey === key;

            return (
              <div key={key} className="border-t">
                <div className="grid grid-cols-[1fr_100px_160px_auto] gap-4 px-4 py-3 items-center">
                  <div>
                    <p className="text-sm font-medium">
                      {displayName}
                      {entry.isCurrentUser && (
                        <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">{entry.email}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{loc.locationName}</p>
                  </div>
                  <div>
                    <RoleBadge role={loc.role} />
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {PERM_LABELS.map(({ key: pk, label }) => (
                      <span key={pk} className="flex items-center gap-1 text-xs text-muted-foreground" title={label}>
                        <PermDot active={loc.permissions[pk]} />
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-1.5 justify-end flex-wrap">
                    {!entry.isCurrentUser && (
                      <>
                        <Button variant="outline" size="xs" disabled={pending} onClick={() => { setSetPasswordFor({ userId: entry.userId, name: displayName }); setNewPassword(""); }}>
                          Set password
                        </Button>
                        <Button variant="outline" size="xs" disabled={pending} onClick={() => handleResetLogin(entry.email)}>
                          Reset login
                        </Button>
                        {entry.hasMfa && (
                          <Button variant="outline" size="xs" disabled={pending} onClick={() => handleResetMfa(entry.userId, displayName)}>
                            Reset MFA
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="xs"
                          disabled={pending}
                          onClick={() =>
                            isEditing
                              ? cancelEdit()
                              : startEdit(entry.userId, loc.locationId, loc.permissions, loc.role)
                          }
                        >
                          {isEditing ? "Cancel" : "Edit"}
                        </Button>
                        <Button
                          variant="destructive"
                          size="xs"
                          disabled={pending}
                          onClick={() => handleRemove(entry.userId, loc.locationId, displayName)}
                        >
                          Remove
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {/* Inline edit panel */}
                {isEditing && editPerms && (
                  <div className="px-4 pb-4 border-t bg-muted/20">
                    <div className="pt-4 flex flex-col gap-4">
                      <div className="flex items-center gap-3">
                        <Label htmlFor={`role-${key}`} className="text-sm shrink-0">Role</Label>
                        <select
                          id={`role-${key}`}
                          value={editRole}
                          onChange={(e) => setEditRole(e.target.value)}
                          disabled={pending}
                          className={inputClass + " max-w-[160px]"}
                        >
                          <option value="staff">Staff</option>
                          <option value="manager">Manager</option>
                        </select>
                        <button
                          type="button"
                          className="text-xs text-muted-foreground underline"
                          onClick={() =>
                            setEditPerms(DEFAULT_PERMISSIONS[editRole] ?? DEFAULT_PERMISSIONS.staff)
                          }
                        >
                          Reset to defaults
                        </button>
                      </div>
                      <div>
                        <p className="text-sm font-medium mb-2">Permissions</p>
                        <PermissionsGrid
                          perms={editPerms}
                          onChange={setEditPerms}
                          disabled={pending}
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          disabled={pending}
                          onClick={() => saveEdit(entry.userId, loc.locationId)}
                        >
                          {pending ? "Saving…" : "Save changes"}
                        </Button>
                        <Button variant="outline" size="sm" onClick={cancelEdit} disabled={pending}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          });
        })}
      </div>

      {/* Status messages */}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {success && <p className="text-sm text-green-700">{success}</p>}

      {/* Set password inline form */}
      {setPasswordFor && (
        <form onSubmit={handleSetPassword} className="rounded-lg border p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Set password for {setPasswordFor.name}</p>
            <button type="button" className="text-xs text-muted-foreground underline" onClick={() => { setSetPasswordFor(null); setNewPassword(""); }}>Cancel</button>
          </div>
          <div className="flex gap-2 items-end">
            <div className="flex flex-col gap-1.5 flex-1">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Min. 8 characters"
                minLength={8}
                required
                disabled={pending}
              />
            </div>
            <Button type="submit" size="sm" disabled={pending || newPassword.length < 8}>
              {pending ? "Saving…" : "Set password"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Staff member can change this after logging in.</p>
        </form>
      )}

      {/* Invite link (shown after successful invite — fallback if email doesn't arrive) */}
      {inviteLink && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-4 flex flex-col gap-2">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Invite sent — share this link as a backup</p>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">An email was sent. If it doesn&apos;t arrive, share this link directly. Single-use, expires in 24h.</p>
            </div>
            <button onClick={() => setInviteLink(null)} className="text-xs text-amber-600 underline shrink-0">Dismiss</button>
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded bg-amber-100 dark:bg-amber-900/40 px-2 py-1.5 text-xs break-all font-mono text-amber-900 dark:text-amber-200">
              {inviteLink}
            </code>
            <button
              onClick={() => copyText(inviteLink)}
              className="shrink-0 rounded border border-amber-300 dark:border-amber-700 px-2 py-1 text-xs text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40"
            >
              Copy
            </button>
          </div>
        </div>
      )}

      {/* Password reset link */}
      {resetLink && (
        <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 p-4 flex flex-col gap-2">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-blue-800 dark:text-blue-300">Password reset link for {resetLink.email}</p>
              <p className="text-xs text-blue-700 dark:text-blue-400 mt-0.5">Share this with the staff member. Single-use, expires in 1h.</p>
            </div>
            <button onClick={() => setResetLink(null)} className="text-xs text-blue-600 underline shrink-0">Dismiss</button>
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded bg-blue-100 dark:bg-blue-900/40 px-2 py-1.5 text-xs break-all font-mono text-blue-900 dark:text-blue-200">
              {resetLink.link}
            </code>
            <button
              onClick={() => copyText(resetLink.link)}
              className="shrink-0 rounded border border-blue-300 dark:border-blue-700 px-2 py-1 text-xs text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/40"
            >
              Copy
            </button>
          </div>
        </div>
      )}

      {/* Invite panel */}
      {!showInvite ? (
        <div>
          <Button onClick={() => setShowInvite(true)}>+ Invite team member</Button>
        </div>
      ) : (
        <form onSubmit={handleInviteSubmit} className="rounded-lg border p-5 flex flex-col gap-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Invite team member
            </h3>
            <button
              type="button"
              className="text-xs text-muted-foreground underline"
              onClick={() => setShowInvite(false)}
            >
              Cancel
            </button>
          </div>

          {/* Basic info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="inv-email">Email address</Label>
              <Input
                id="inv-email"
                type="email"
                value={invite.email}
                onChange={(e) => setInvite((p) => ({ ...p, email: e.target.value }))}
                placeholder="aaron@yourgarage.co.uk"
                required
                disabled={pending}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="inv-name">Full name (optional)</Label>
              <Input
                id="inv-name"
                type="text"
                value={invite.fullName}
                onChange={(e) => setInvite((p) => ({ ...p, fullName: e.target.value }))}
                placeholder="Aaron Smith"
                disabled={pending}
              />
            </div>
          </div>

          {/* Access scope */}
          <div className="flex flex-col gap-2">
            <Label>Access level</Label>
            <div className="flex flex-col gap-2">
              {locations.length > 1 && (
                <label className="flex items-start gap-3 rounded-md border p-3 cursor-pointer hover:bg-muted/30">
                  <input
                    type="radio"
                    checked={invite.scope === "org"}
                    onChange={() => setInvite((p) => ({ ...p, scope: "org", role: "admin" }))}
                    disabled={pending}
                    className="mt-0.5"
                  />
                  <div>
                    <p className="text-sm font-medium">All locations (Admin)</p>
                    <p className="text-xs text-muted-foreground">
                      Full access to every location in the organisation
                    </p>
                  </div>
                </label>
              )}
              <label className="flex items-start gap-3 rounded-md border p-3 cursor-pointer hover:bg-muted/30">
                <input
                  type="radio"
                  checked={invite.scope === "location"}
                  onChange={() =>
                    setInvite((p) => ({
                      ...p,
                      scope: "location",
                      role: p.role === "admin" ? "staff" : p.role,
                    }))
                  }
                  disabled={pending}
                  className="mt-0.5"
                />
                <div className="flex-1">
                  <p className="text-sm font-medium">Specific location</p>
                  <p className="text-xs text-muted-foreground mb-2">
                    Access to one location with customisable permissions
                  </p>
                  {invite.scope === "location" && (
                    <select
                      value={invite.locationId}
                      onChange={(e) => setInvite((p) => ({ ...p, locationId: e.target.value }))}
                      disabled={pending}
                      className={inputClass + " max-w-xs"}
                    >
                      {locations.map((l) => (
                        <option key={l.id} value={l.id}>{l.name}</option>
                      ))}
                    </select>
                  )}
                </div>
              </label>
            </div>
          </div>

          {/* Role (location scope only) */}
          {invite.scope === "location" && (
            <div className="flex flex-col gap-2">
              <Label>Role</Label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { value: "manager", label: "Manager", desc: "Leads the location, access to most features" },
                  { value: "staff", label: "Staff", desc: "Day-to-day work: bookings, customers, reminders" },
                ].map((r) => (
                  <label
                    key={r.value}
                    className={`flex items-start gap-2.5 rounded-md border p-3 cursor-pointer transition-colors ${
                      invite.role === r.value ? "border-primary bg-muted/30" : "hover:bg-muted/20"
                    }`}
                  >
                    <input
                      type="radio"
                      checked={invite.role === r.value}
                      onChange={() => handleRoleChange(r.value)}
                      disabled={pending}
                      className="mt-0.5"
                    />
                    <div>
                      <p className="text-sm font-medium">{r.label}</p>
                      <p className="text-xs text-muted-foreground">{r.desc}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Permissions (location scope only) */}
          {invite.scope === "location" && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label>Permissions</Label>
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline"
                  onClick={() =>
                    setInvite((p) => ({
                      ...p,
                      permissions: DEFAULT_PERMISSIONS[p.role] ?? DEFAULT_PERMISSIONS.staff,
                    }))
                  }
                >
                  Reset to role defaults
                </button>
              </div>
              <PermissionsGrid
                perms={invite.permissions}
                onChange={(p) => setInvite((prev) => ({ ...prev, permissions: p }))}
                disabled={pending}
              />
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-2">
            <Button type="submit" disabled={pending || !invite.email}>
              {pending ? "Sending invite…" : "Send invite"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowInvite(false)}
              disabled={pending}
            >
              Cancel
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            An invite email is sent. They set their password and get immediate access once accepted.
          </p>
        </form>
      )}
    </div>
  );
}
