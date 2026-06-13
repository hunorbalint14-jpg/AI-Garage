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
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { Search, Plus, MoreVertical } from "lucide-react";

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

const FILTER_OPTIONS = [
  { value: "all", label: "All roles" },
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Admin" },
  ...ROLE_OPTIONS,
];

const AVATAR_STYLES: Record<string, string> = {
  owner: "bg-amber-500/[0.13] text-amber-300 shadow-[inset_0_0_0_1px_rgb(253_211_77_/_0.28)]",
  admin: "bg-blue-500/[0.13] text-blue-300 shadow-[inset_0_0_0_1px_rgb(147_197_253_/_0.28)]",
  manager: "bg-purple-500/[0.13] text-purple-300 shadow-[inset_0_0_0_1px_rgb(196_181_253_/_0.28)]",
  service_advisor: "bg-cyan-500/[0.13] text-cyan-300 shadow-[inset_0_0_0_1px_rgb(103_232_249_/_0.28)]",
  mechanic: "bg-emerald-500/[0.13] text-emerald-300 shadow-[inset_0_0_0_1px_rgb(134_239_172_/_0.28)]",
  apprentice: "bg-teal-500/[0.13] text-teal-300 shadow-[inset_0_0_0_1px_rgb(94_234_212_/_0.28)]",
  receptionist: "bg-pink-500/[0.13] text-pink-300 shadow-[inset_0_0_0_1px_rgb(249_168_212_/_0.28)]",
  parts: "bg-orange-500/[0.13] text-orange-300 shadow-[inset_0_0_0_1px_rgb(253_186_116_/_0.28)]",
  bookkeeper: "bg-indigo-500/[0.13] text-indigo-300 shadow-[inset_0_0_0_1px_rgb(165_180_252_/_0.28)]",
  staff: "bg-white/[0.07] text-foreground/80 shadow-[inset_0_0_0_1px_rgb(255_255_255_/_0.1)]",
};

function initialsFor(name: string | null, email: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/).map((w) => w[0]).filter(Boolean);
    if (parts.length) return parts.join("").toUpperCase().slice(0, 2);
  }
  return email.slice(0, 2).toUpperCase();
}

function MemberAvatar({ role, name, email }: { role: string; name: string | null; email: string }) {
  return (
    <div
      className={`flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-full text-[16.5px] font-semibold ${AVATAR_STYLES[role] ?? AVATAR_STYLES.staff}`}
    >
      {initialsFor(name, email)}
    </div>
  );
}

function MfaBadge({ on }: { on: boolean }) {
  return on ? (
    <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] font-medium text-green-300 bg-green-500/[0.12]">
      <span className="h-[5px] w-[5px] rounded-full bg-green-400" />
      MFA on
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] font-medium text-muted-foreground bg-white/5">
      <span className="h-[5px] w-[5px] rounded-full bg-muted-foreground/70" />
      No MFA
    </span>
  );
}

function SkillChip({ label, tone }: { label: string; tone: "blue" | "green" | "amber" }) {
  const tones: Record<string, string> = {
    blue: "text-blue-300 bg-blue-500/[0.12]",
    green: "text-green-300 bg-green-500/[0.12]",
    amber: "text-amber-300 bg-amber-500/[0.12]",
  };
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10.5px] font-medium ${tones[tone]}`}>
      {label}
    </span>
  );
}

const overflowTriggerClass = cn(
  buttonVariants({ variant: "ghost", size: "icon-sm" }),
  "text-muted-foreground"
);

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
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");

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

  const visibleEntries = entries.filter((entry) => {
    const hay = `${entry.fullName ?? ""} ${entry.email}`.toLowerCase();
    const okSearch = hay.includes(search.trim().toLowerCase());
    const okRole =
      roleFilter === "all" ||
      entry.orgRole === roleFilter ||
      entry.locationEntries.some((l) => l.role === roleFilter);
    return okSearch && okRole;
  });
  const visibleCount = visibleEntries.reduce(
    (n, e) => n + (e.orgRole ? 1 : e.locationEntries.length),
    0,
  );
  const isFiltering = search.trim() !== "" || roleFilter !== "all";

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-[160px] max-w-[320px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-[15px] -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search team…"
            className="h-[34px] bg-white/[0.03] pl-9"
          />
        </div>
        <NativeSelect
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="h-[34px] w-auto max-w-[170px] bg-white/[0.03]"
        >
          {FILTER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </NativeSelect>
        <div className="flex-1" />
        <span className="text-sm text-muted-foreground">
          {visibleCount} member{visibleCount === 1 ? "" : "s"}
        </span>
        <Button onClick={() => setShowInvite(true)}>
          <Plus className="size-4" /> Invite team member
        </Button>
      </div>

      {/* Staff list */}
      <div className="flex flex-col gap-2.5">
        {visibleEntries.length === 0 && (
          <div className="rounded-xl border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
            {isFiltering ? "No members match your search." : "No staff found. Invite your first team member below."}
          </div>
        )}

        {visibleEntries.map((entry) => {
          const displayName = entry.fullName ?? entry.email;
          const isOrg = !!entry.orgRole;

          if (isOrg) {
            return (
              <div
                key={`org-${entry.userId}`}
                className="flex flex-wrap items-center gap-4 rounded-xl border bg-card px-[18px] py-4 hover:bg-white/[0.015] sm:flex-nowrap"
              >
                <MemberAvatar role={entry.orgRole!} name={entry.fullName} email={entry.email} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="text-[15.5px] font-semibold text-foreground">{displayName}</span>
                    {entry.isCurrentUser && <span className="text-xs text-muted-foreground">(you)</span>}
                    <RoleBadge role={entry.orgRole!} />
                  </div>
                  <p className="mt-[3px] text-[12.5px] text-muted-foreground">{entry.email} · All locations</p>
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-[oklch(0.82_0_0)]">Full access</span>
                    <MfaBadge on={entry.hasMfa} />
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5 self-start sm:self-center">
                  {entry.isCurrentUser ? (
                    <span className="text-xs text-muted-foreground opacity-70">—</span>
                  ) : (
                    <DropdownMenu>
                      <DropdownMenuTrigger className={overflowTriggerClass} aria-label="More actions">
                        <MoreVertical className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem
                          onClick={() => { setSetPasswordFor({ userId: entry.userId, name: displayName }); setNewPassword(""); }}
                        >
                          Set password
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleResetLogin(entry.email)}>
                          Reset login
                        </DropdownMenuItem>
                        {entry.hasMfa && (
                          <DropdownMenuItem onClick={() => handleResetMfa(entry.userId, displayName)}>
                            Reset MFA
                          </DropdownMenuItem>
                        )}
                        {(isOwner || isAdmin) && entry.orgRole !== "owner" && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" onClick={() => handleRemove(entry.userId, null, displayName)}>
                              Remove from organisation
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
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
              <div key={key} className="flex flex-col">
                <div
                  className={`flex flex-wrap items-center gap-4 rounded-xl border bg-card px-[18px] py-4 hover:bg-white/[0.015] sm:flex-nowrap ${isEditing ? "rounded-b-none" : ""}`}
                >
                  <MemberAvatar role={loc.role} name={entry.fullName} email={entry.email} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="text-[15.5px] font-semibold text-foreground">{displayName}</span>
                      {entry.isCurrentUser && <span className="text-xs text-muted-foreground">(you)</span>}
                      <RoleBadge role={loc.role} />
                      {tpl && !tpl.isSystem && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground" title="Custom template">
                          {tpl.label}
                        </span>
                      )}
                    </div>
                    <p className="mt-[3px] text-[12.5px] text-muted-foreground">{entry.email} &nbsp;·&nbsp; {loc.locationName}</p>
                    <div className="mt-2.5 flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
                        {enabledCount} permissions
                      </span>
                      {loc.motTester && <SkillChip label="MOT tester" tone="blue" />}
                      {loc.motQcReviewer && <SkillChip label="QC reviewer" tone="blue" />}
                      {loc.evLevel > 0 && (
                        <SkillChip
                          label={`EV L${loc.evLevel}${qualExpired(loc.evExpiresAt) ? " (expired)" : ""}`}
                          tone={isHvQualified(loc.evLevel) && !qualExpired(loc.evExpiresAt) ? "green" : "amber"}
                        />
                      )}
                      <MfaBadge on={entry.hasMfa} />
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5 self-start sm:self-center">
                    {entry.isCurrentUser ? (
                      <span className="text-xs text-muted-foreground opacity-70">—</span>
                    ) : (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={pending}
                          onClick={() =>
                            isEditing
                              ? cancelEdit()
                              : startEdit(entry.userId, loc.locationId, loc.permissions, loc.role, loc.motTester, loc.motQcReviewer, loc.evLevel, loc.evCertifiedAt, loc.evExpiresAt)
                          }
                        >
                          {isEditing ? "Cancel" : "Edit"}
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger className={overflowTriggerClass} aria-label="More actions">
                            <MoreVertical className="size-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem
                              onClick={() => { setSetPasswordFor({ userId: entry.userId, name: displayName }); setNewPassword(""); }}
                            >
                              Set password
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleResetLogin(entry.email)}>
                              Reset login
                            </DropdownMenuItem>
                            {entry.hasMfa && (
                              <DropdownMenuItem onClick={() => handleResetMfa(entry.userId, displayName)}>
                                Reset MFA
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" onClick={() => handleRemove(entry.userId, loc.locationId, displayName)}>
                              Remove from location
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </>
                    )}
                  </div>
                </div>

                {isEditing && editPerms && (
                  <div className="-mt-px rounded-b-xl border border-t-0 bg-muted/20 px-4 pb-4">
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

      {showInvite && (
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
