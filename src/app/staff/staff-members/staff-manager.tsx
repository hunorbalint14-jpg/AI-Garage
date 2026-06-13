"use client";

import { useState, useTransition } from "react";
import {
  inviteStaffMember,
  updateStaffPermissions,
  updateStaffRole,
  updateStaffMotFlags,
  updateStaffEvQual,
  removeStaffMember,
  resetStaffPassword,
  resetStaffMfa,
  setStaffPassword,
} from "./actions";
import { EV_LEVEL_LABELS, isHvQualified, qualExpired } from "@/lib/ev-readiness";
import {
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
  HARD_OWNER_ADMIN_PERMS,
  type Permissions,
  normalisePermissions,
} from "./constants";
import type { StaffEntry, LocationOption, RoleTemplateOption } from "./page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const ROLE_OPTIONS = [
  { value: "manager", label: "Manager" },
  { value: "service_advisor", label: "Service Advisor" },
  { value: "mechanic", label: "Mechanic" },
  { value: "apprentice", label: "Apprentice" },
  { value: "receptionist", label: "Receptionist" },
  { value: "parts", label: "Parts / Stores" },
  { value: "bookkeeper", label: "Bookkeeper" },
  { value: "staff", label: "Staff (legacy)" },
];

function PermDot({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${active ? "bg-green-500" : "bg-muted"}`}
    />
  );
}

function RoleBadge({ role }: { role: string }) {
  const styles: Record<string, string> = {
    owner: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
    admin: "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300",
    manager: "bg-purple-100 text-purple-800 dark:bg-purple-950/40 dark:text-purple-300",
    service_advisor: "bg-cyan-100 text-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-300",
    mechanic: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
    apprentice: "bg-teal-100 text-teal-800 dark:bg-teal-950/40 dark:text-teal-300",
    receptionist: "bg-pink-100 text-pink-800 dark:bg-pink-950/40 dark:text-pink-300",
    parts: "bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300",
    bookkeeper: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300",
    staff: "bg-muted text-muted-foreground",
  };
  const label = ROLE_OPTIONS.find((r) => r.value === role)?.label ?? role;
  return (
    <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${styles[role] ?? styles.staff}`}>
      {label}
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
    <div className="flex flex-col gap-3">
      {PERMISSION_GROUPS.map((g) => (
        <div key={g.label} className="rounded-md border p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{g.label}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
            {g.keys.map((k) => {
              const meta = PERMISSION_LABELS[k];
              const locked = HARD_OWNER_ADMIN_PERMS.includes(k);
              return (
                <label
                  key={k}
                  className={`flex items-start gap-2 rounded-md border p-2 ${locked ? "opacity-60" : "cursor-pointer hover:bg-muted/40"} transition-colors`}
                  title={locked ? "Owner/admin only — cannot be granted via template" : meta.desc}
                >
                  <input
                    type="checkbox"
                    checked={perms[k]}
                    onChange={(e) => onChange({ ...perms, [k]: e.target.checked })}
                    disabled={disabled || locked}
                    className="mt-0.5 shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-medium leading-tight">
                      {meta.label}
                      {locked && <span className="ml-1 text-[10px] text-muted-foreground">(owner only)</span>}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{meta.desc}</p>
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

type InviteFormState = {
  email: string;
  fullName: string;
  scope: "org" | "location";
  locationId: string;
  templateId: string;
  role: string;
  permissions: Permissions;
  motTester: boolean;
  motQcReviewer: boolean;
};

function findTemplate(templates: RoleTemplateOption[], id: string | null): RoleTemplateOption | null {
  if (!id) return null;
  return templates.find((t) => t.id === id) ?? null;
}

function templateForRole(templates: RoleTemplateOption[], role: string): RoleTemplateOption | null {
  // Prefer system template with matching key; fall back to first custom with key.
  return templates.find((t) => t.key === role && t.isSystem)
    ?? templates.find((t) => t.key === role)
    ?? null;
}

export function StaffManager({
  entries,
  locations,
  templates,
  isOwner,
  isAdmin,
}: {
  entries: StaffEntry[];
  locations: LocationOption[];
  templates: RoleTemplateOption[];
  currentUserId: string;
  isOwner: boolean;
  isAdmin: boolean;
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
  const [editMotTester, setEditMotTester] = useState(false);
  const [editMotQc, setEditMotQc] = useState(false);
  const [editEvLevel, setEditEvLevel] = useState(0);
  const [editEvCertified, setEditEvCertified] = useState("");
  const [editEvExpires, setEditEvExpires] = useState("");

  const defaultTemplate =
    templateForRole(templates, "mechanic") ?? templates.find((t) => t.isSystem) ?? null;

  const [invite, setInvite] = useState<InviteFormState>({
    email: "",
    fullName: "",
    scope: "location",
    locationId: locations[0]?.id ?? "",
    templateId: defaultTemplate?.id ?? "",
    role: defaultTemplate?.key ?? "mechanic",
    permissions: defaultTemplate?.permissions ?? normalisePermissions(null),
    motTester: false,
    motQcReviewer: false,
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

  function applyInviteTemplate(templateId: string) {
    const t = findTemplate(templates, templateId);
    if (!t) {
      setInvite((p) => ({ ...p, templateId }));
      return;
    }
    setInvite((p) => ({
      ...p,
      templateId,
      role: t.key in Object.fromEntries(ROLE_OPTIONS.map((r) => [r.value, true])) ? t.key : p.role,
      permissions: t.permissions,
    }));
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
    formData.set("templateId", invite.templateId);
    if (invite.motTester) formData.set("mot_tester", "on");
    if (invite.motQcReviewer) formData.set("mot_qc_reviewer", "on");
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
          templateId: defaultTemplate?.id ?? "",
          role: defaultTemplate?.key ?? "mechanic",
          permissions: defaultTemplate?.permissions ?? normalisePermissions(null),
          motTester: false,
          motQcReviewer: false,
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

  function startEdit(
    userId: string,
    locationId: string,
    currentPerms: Permissions,
    currentRole: string,
    motTester: boolean,
    motQc: boolean,
    evLevel: number,
    evCertified: string | null,
    evExpires: string | null,
  ) {
    setEditingKey(`${userId}|${locationId}`);
    setEditPerms({ ...currentPerms });
    setEditRole(currentRole);
    setEditMotTester(motTester);
    setEditMotQc(motQc);
    setEditEvLevel(evLevel);
    setEditEvCertified(evCertified ?? "");
    setEditEvExpires(evExpires ?? "");
    setError(null);
  }

  function cancelEdit() {
    setEditingKey(null);
    setEditPerms(null);
    setEditRole("");
    setEditMotTester(false);
    setEditMotQc(false);
    setEditEvLevel(0);
    setEditEvCertified("");
    setEditEvExpires("");
  }

  function applyEditTemplate(t: RoleTemplateOption) {
    setEditPerms(t.permissions);
    if (ROLE_OPTIONS.some((r) => r.value === t.key)) setEditRole(t.key);
  }

  function saveEdit(
    userId: string,
    locationId: string,
    prevMotTester: boolean,
    prevMotQc: boolean,
    prevEvLevel: number,
    prevEvCertified: string | null,
    prevEvExpires: string | null,
  ) {
    if (!editPerms) return;
    setError(null);
    startTransition(async () => {
      const tasks: Promise<{ error: string } | { success: true }>[] = [
        updateStaffPermissions(userId, locationId, editPerms),
        updateStaffRole(userId, locationId, editRole),
      ];
      if (editMotTester !== prevMotTester || editMotQc !== prevMotQc) {
        tasks.push(updateStaffMotFlags(userId, locationId, editMotTester, editMotQc));
      }
      if (
        editEvLevel !== prevEvLevel ||
        editEvCertified !== (prevEvCertified ?? "") ||
        editEvExpires !== (prevEvExpires ?? "")
      ) {
        tasks.push(
          updateStaffEvQual(
            userId,
            locationId,
            editEvLevel,
            editEvCertified || null,
            editEvExpires || null,
          ),
        );
      }
      const results = await Promise.all(tasks);
      const err = results
        .map((r) => ("error" in r ? r.error : null))
        .find(Boolean);
      if (err) {
        setError(err);
        return;
      }
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
        {/* Desktop header */}
        <div className="hidden md:grid bg-muted/50 grid-cols-[1fr_140px_180px_auto] gap-4 px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
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

          if (isOrg) {
            return (
              <div key={`org-${entry.userId}`} className="border-t">
                <div className="grid grid-cols-1 md:grid-cols-[1fr_140px_180px_auto] gap-2 md:gap-4 px-4 py-3 md:items-center">
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
                  <div className="flex items-center gap-2">
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
                  <div className="flex gap-1.5 md:justify-end flex-wrap">
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
                    {(isOwner || isAdmin) && entry.orgRole !== "owner" && !entry.isCurrentUser && (
                      <Button variant="destructive" size="xs" disabled={pending} onClick={() => handleRemove(entry.userId, null, displayName)}>
                        Remove
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          }

          return entry.locationEntries.map((loc) => {
            const key = `${entry.userId}|${loc.locationId}`;
            const isEditing = editingKey === key;
            const tpl = findTemplate(templates, loc.templateId);
            const enabledCount = Object.values(loc.permissions).filter(Boolean).length;

            return (
              <div key={key} className="border-t">
                <div className="grid grid-cols-1 md:grid-cols-[1fr_140px_180px_auto] gap-2 md:gap-4 px-4 py-3 md:items-center">
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
                  <div className="flex items-center gap-2 flex-wrap">
                    <RoleBadge role={loc.role} />
                    {tpl && !tpl.isSystem && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground" title="Custom template">
                        {tpl.label}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5 items-center">
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <PermDot active={enabledCount > 0} /> {enabledCount} perms
                    </span>
                    {loc.motTester && (
                      <span className="rounded bg-blue-100 dark:bg-blue-950/40 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:text-blue-300">MOT tester</span>
                    )}
                    {loc.motQcReviewer && (
                      <span className="rounded bg-blue-100 dark:bg-blue-950/40 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:text-blue-300">QC reviewer</span>
                    )}
                    {loc.evLevel > 0 && (
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          isHvQualified(loc.evLevel) && !qualExpired(loc.evExpiresAt)
                            ? "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300"
                            : "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                        }`}
                        title={EV_LEVEL_LABELS[loc.evLevel]}
                      >
                        EV L{loc.evLevel}{qualExpired(loc.evExpiresAt) ? " (expired)" : ""}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-1.5 md:justify-end flex-wrap">
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
                              : startEdit(entry.userId, loc.locationId, loc.permissions, loc.role, loc.motTester, loc.motQcReviewer, loc.evLevel, loc.evCertifiedAt, loc.evExpiresAt)
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

                {isEditing && editPerms && (
                  <div className="px-4 pb-4 border-t bg-muted/20">
                    <div className="pt-4 flex flex-col gap-4">
                      <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-3 sm:items-center">
                        <Label htmlFor={`role-${key}`} className="text-sm">Role</Label>
                        <select
                          id={`role-${key}`}
                          value={editRole}
                          onChange={(e) => setEditRole(e.target.value)}
                          disabled={pending}
                          className={inputClass + " sm:max-w-[220px]"}
                        >
                          {ROLE_OPTIONS.map((r) => (
                            <option key={r.value} value={r.value}>{r.label}</option>
                          ))}
                        </select>
                        <Label className="text-sm">Apply template</Label>
                        <div className="flex flex-wrap gap-2 items-center">
                          <select
                            disabled={pending}
                            defaultValue=""
                            onChange={(e) => {
                              const t = findTemplate(templates, e.target.value);
                              if (t) applyEditTemplate(t);
                              e.target.value = "";
                            }}
                            className={inputClass + " sm:max-w-[280px]"}
                          >
                            <option value="">Choose a template…</option>
                            <optgroup label="System">
                              {templates.filter((t) => t.isSystem).map((t) => (
                                <option key={t.id} value={t.id}>{t.label}</option>
                              ))}
                            </optgroup>
                            {templates.some((t) => !t.isSystem) && (
                              <optgroup label="Custom">
                                {templates.filter((t) => !t.isSystem).map((t) => (
                                  <option key={t.id} value={t.id}>{t.label}</option>
                                ))}
                              </optgroup>
                            )}
                          </select>
                          <span className="text-xs text-muted-foreground">
                            Replaces all permissions below
                          </span>
                        </div>
                      </div>

                      <div>
                        <p className="text-sm font-medium mb-2">Permissions</p>
                        <PermissionsGrid perms={editPerms} onChange={setEditPerms} disabled={pending} />
                      </div>

                      <div className="rounded-md border p-3">
                        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">MOT (DVSA)</p>
                        <div className="flex flex-col gap-2">
                          <label className="flex items-start gap-2 text-sm cursor-pointer">
                            <input
                              type="checkbox"
                              checked={editMotTester}
                              onChange={(e) => setEditMotTester(e.target.checked)}
                              disabled={pending}
                              className="mt-0.5"
                            />
                            <span>
                              <span className="font-medium">MOT tester certified</span>
                              <span className="block text-xs text-muted-foreground">
                                Labels this member as a DVSA MOT tester. DVSA MTS enforces tester separation externally.
                              </span>
                            </span>
                          </label>
                          <label className="flex items-start gap-2 text-sm cursor-pointer">
                            <input
                              type="checkbox"
                              checked={editMotQc}
                              onChange={(e) => setEditMotQc(e.target.checked)}
                              disabled={pending}
                              className="mt-0.5"
                            />
                            <span>
                              <span className="font-medium">QC reviewer</span>
                              <span className="block text-xs text-muted-foreground">
                                Performs the DVSA 2-monthly quality-control check on another tester&apos;s work.
                              </span>
                            </span>
                          </label>
                        </div>
                      </div>

                      <div className="rounded-md border p-3">
                        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">EV / high-voltage (IMI TechSafe)</p>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <label className="text-xs text-muted-foreground">
                            Qualification level
                            <select
                              value={editEvLevel}
                              onChange={(e) => setEditEvLevel(Number(e.target.value))}
                              disabled={pending}
                              className={inputClass + " mt-1"}
                            >
                              <option value={0}>None</option>
                              {[1, 2, 3, 4].map((l) => (
                                <option key={l} value={l}>{EV_LEVEL_LABELS[l]}</option>
                              ))}
                            </select>
                          </label>
                          <label className="text-xs text-muted-foreground">
                            Certified
                            <input
                              type="date"
                              value={editEvCertified}
                              onChange={(e) => setEditEvCertified(e.target.value)}
                              disabled={pending || editEvLevel === 0}
                              className={inputClass + " mt-1"}
                            />
                          </label>
                          <label className="text-xs text-muted-foreground">
                            Expires
                            <input
                              type="date"
                              value={editEvExpires}
                              onChange={(e) => setEditEvExpires(e.target.value)}
                              disabled={pending || editEvLevel === 0}
                              className={inputClass + " mt-1"}
                            />
                          </label>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">
                          Level 2 or above (in date) qualifies the member to work on high-voltage vehicles.
                        </p>
                      </div>

                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          loading={pending}
                          onClick={() => saveEdit(entry.userId, loc.locationId, loc.motTester, loc.motQcReviewer, loc.evLevel, loc.evCertifiedAt, loc.evExpiresAt)}
                        >
                          Save changes
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

      {error && <p className="text-sm text-red-600">{error}</p>}
      {success && <p className="text-sm text-green-700">{success}</p>}

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
            <Button type="submit" size="sm" disabled={newPassword.length < 8} loading={pending}>
              Set password
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Staff member can change this after logging in.</p>
        </form>
      )}

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
                      Full access to every location in the organisation.
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
                      role: p.role === "admin" ? defaultTemplate?.key ?? "mechanic" : p.role,
                    }))
                  }
                  disabled={pending}
                  className="mt-0.5"
                />
                <div className="flex-1">
                  <p className="text-sm font-medium">Specific location</p>
                  <p className="text-xs text-muted-foreground mb-2">
                    Pick a template, then tweak the permissions if needed.
                  </p>
                  {invite.scope === "location" && (
                    <select
                      value={invite.locationId}
                      onChange={(e) => setInvite((p) => ({ ...p, locationId: e.target.value }))}
                      disabled={pending}
                      className={inputClass + " sm:max-w-xs"}
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

          {invite.scope === "location" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Role</Label>
                <select
                  value={invite.role}
                  onChange={(e) => {
                    const r = e.target.value;
                    const t = templateForRole(templates, r);
                    setInvite((p) => ({
                      ...p,
                      role: r,
                      templateId: t?.id ?? "",
                      permissions: t?.permissions ?? p.permissions,
                    }));
                  }}
                  disabled={pending}
                  className={inputClass}
                >
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>Template</Label>
                <select
                  value={invite.templateId}
                  onChange={(e) => applyInviteTemplate(e.target.value)}
                  disabled={pending}
                  className={inputClass}
                >
                  <option value="">(custom — keep current ticks)</option>
                  <optgroup label="System">
                    {templates.filter((t) => t.isSystem).map((t) => (
                      <option key={t.id} value={t.id}>{t.label}</option>
                    ))}
                  </optgroup>
                  {templates.some((t) => !t.isSystem) && (
                    <optgroup label="Custom">
                      {templates.filter((t) => !t.isSystem).map((t) => (
                        <option key={t.id} value={t.id}>{t.label}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>
            </div>
          )}

          {invite.scope === "location" && (
            <>
              <div className="flex flex-col gap-2">
                <Label>Permissions</Label>
                <PermissionsGrid
                  perms={invite.permissions}
                  onChange={(p) => setInvite((prev) => ({ ...prev, permissions: p, templateId: "" }))}
                  disabled={pending}
                />
              </div>

              <div className="rounded-md border p-3">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">MOT (DVSA)</p>
                <div className="flex flex-col gap-2">
                  <label className="flex items-start gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={invite.motTester}
                      onChange={(e) => setInvite((p) => ({ ...p, motTester: e.target.checked }))}
                      disabled={pending}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="font-medium">MOT tester certified</span>
                      <span className="block text-xs text-muted-foreground">
                        DVSA MTS enforces tester separation; this just labels them in AI Garage.
                      </span>
                    </span>
                  </label>
                  <label className="flex items-start gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={invite.motQcReviewer}
                      onChange={(e) => setInvite((p) => ({ ...p, motQcReviewer: e.target.checked }))}
                      disabled={pending}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="font-medium">QC reviewer</span>
                      <span className="block text-xs text-muted-foreground">
                        Performs DVSA 2-monthly quality-control checks.
                      </span>
                    </span>
                  </label>
                </div>
              </div>
            </>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-2">
            <Button type="submit" disabled={!invite.email} loading={pending}>
              Send invite
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
