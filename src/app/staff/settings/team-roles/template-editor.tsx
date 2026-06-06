"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
  HARD_OWNER_ADMIN_PERMS,
  type Permissions,
  type PermissionKey,
} from "@/app/staff/staff-members/constants";
import { createRoleTemplate, updateRoleTemplate, deleteRoleTemplate, cloneRoleTemplate } from "./actions";

export type RoleTemplateView = {
  id: string;
  organization_id: string | null;
  key: string;
  label: string;
  description: string | null;
  permissions: Permissions;
  is_system: boolean;
  sort_order: number;
  updated_at: string;
};

const emptyPerms: Permissions = PERMISSION_GROUPS.flatMap((g) => g.keys).reduce((acc, k) => {
  acc[k] = false;
  return acc;
}, {} as Permissions);

export function TemplateEditor({
  system,
  custom,
}: {
  system: RoleTemplateView[];
  custom: RoleTemplateView[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<{ label: string; description: string; permissions: Permissions }>({
    label: "",
    description: "",
    permissions: emptyPerms,
  });

  function flash(msg: string) {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 2500);
  }

  function startCreate() {
    setError(null);
    setEditingId(null);
    setCreating(true);
    setDraft({ label: "", description: "", permissions: emptyPerms });
  }

  function startEdit(t: RoleTemplateView) {
    setError(null);
    setCreating(false);
    setEditingId(t.id);
    setDraft({
      label: t.label,
      description: t.description ?? "",
      permissions: t.permissions,
    });
  }

  function cancel() {
    setEditingId(null);
    setCreating(false);
    setError(null);
  }

  function clone(t: RoleTemplateView) {
    const proposed = window.prompt(`Name for the new template (cloning "${t.label}"):`, `${t.label} (copy)`);
    if (!proposed) return;
    setError(null);
    startTransition(async () => {
      const res = await cloneRoleTemplate(t.id, proposed);
      if (!res.ok) setError(res.error);
      else flash(`Template "${proposed}" created.`);
    });
  }

  function remove(t: RoleTemplateView) {
    if (!window.confirm(`Delete template "${t.label}"? Existing members keep their stored permissions.`)) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteRoleTemplate(t.id);
      if (!res.ok) setError(res.error);
      else flash(`Template "${t.label}" deleted.`);
    });
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData();
    fd.set("label", draft.label);
    fd.set("description", draft.description);
    for (const [k, v] of Object.entries(draft.permissions)) {
      if (v) fd.set(`perm_${k}`, "on");
    }
    startTransition(async () => {
      const res = creating
        ? await createRoleTemplate(fd)
        : editingId
        ? await updateRoleTemplate(editingId, fd)
        : null;
      if (!res) return;
      if (!res.ok) setError(res.error);
      else {
        flash(creating ? "Template created." : "Template updated.");
        cancel();
      }
    });
  }

  const togglePerm = (k: PermissionKey) =>
    setDraft((d) => ({ ...d, permissions: { ...d.permissions, [k]: !d.permissions[k] } }));

  return (
    <div className="flex flex-col gap-6">
      {error && <p className="text-sm text-red-600">{error}</p>}
      {success && <p className="text-sm text-green-700">{success}</p>}

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Custom templates</h2>
          {!creating && !editingId && (
            <Button size="sm" onClick={startCreate}>+ New template</Button>
          )}
        </div>

        {custom.length === 0 && !creating && (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No custom templates yet. Clone a system template or create one from scratch.
          </p>
        )}

        <ul className="flex flex-col gap-2">
          {custom.map((t) => (
            <li key={t.id} className="rounded-lg border bg-card p-3">
              {editingId === t.id ? (
                <form onSubmit={submit}>
                  <DraftFields
                    draft={draft}
                    setDraft={setDraft}
                    togglePerm={togglePerm}
                    pending={pending}
                  />
                  <div className="mt-3 flex gap-2">
                    <Button type="submit" size="sm" loading={pending}>Save</Button>
                    <Button type="button" variant="outline" size="sm" onClick={cancel} disabled={pending}>Cancel</Button>
                  </div>
                </form>
              ) : (
                <RowSummary template={t}>
                  <Button variant="outline" size="xs" disabled={pending} onClick={() => startEdit(t)}>Edit</Button>
                  <Button variant="outline" size="xs" disabled={pending} onClick={() => clone(t)}>Clone</Button>
                  <Button variant="destructive" size="xs" disabled={pending} onClick={() => remove(t)}>Delete</Button>
                </RowSummary>
              )}
            </li>
          ))}

          {creating && (
            <li className="rounded-lg border border-primary/40 bg-card p-3">
              <form onSubmit={submit}>
                <DraftFields draft={draft} setDraft={setDraft} togglePerm={togglePerm} pending={pending} />
                <div className="mt-3 flex gap-2">
                  <Button type="submit" size="sm" disabled={!draft.label.trim()} loading={pending}>
                    Create template
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={cancel} disabled={pending}>Cancel</Button>
                </div>
              </form>
            </li>
          )}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">System templates</h2>
        <p className="text-xs text-muted-foreground">
          Read-only baselines from UK garage research. Clone to make your own.
        </p>
        <ul className="flex flex-col gap-2">
          {system.map((t) => (
            <li key={t.id} className="rounded-lg border bg-muted/20 p-3">
              <RowSummary template={t}>
                <Button variant="outline" size="xs" disabled={pending} onClick={() => clone(t)}>Clone</Button>
              </RowSummary>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border p-4 text-xs text-muted-foreground space-y-2">
        <p className="font-medium text-foreground">Snapshot semantics</p>
        <p>
          When you apply a template to a team member, the permissions are <strong>copied</strong> to that user&apos;s
          record. Editing the template afterwards does <strong>not</strong> automatically update existing members —
          re-apply the template on each user if you want them in sync. This protects against accidental privilege escalation.
        </p>
        <p>
          <strong>Locked permissions</strong> ({HARD_OWNER_ADMIN_PERMS.map((k) => PERMISSION_LABELS[k].label).join(", ")})
          can only be exercised by org owners and admins, regardless of the template — they&apos;re shown so you understand
          the full surface, not because templates can grant them.
        </p>
      </section>
    </div>
  );
}

function RowSummary({ template, children }: { template: RoleTemplateView; children?: React.ReactNode }) {
  const enabledCount = Object.values(template.permissions).filter(Boolean).length;
  const total = Object.values(template.permissions).length;
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-sm font-medium">{template.label}</h3>
          <code className="text-[10px] text-muted-foreground font-mono">{template.key}</code>
          <span className="text-xs text-muted-foreground">{enabledCount} / {total} permissions</span>
        </div>
        {template.description && (
          <p className="mt-0.5 text-xs text-muted-foreground">{template.description}</p>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function DraftFields({
  draft,
  setDraft,
  togglePerm,
  pending,
}: {
  draft: { label: string; description: string; permissions: Permissions };
  setDraft: (d: { label: string; description: string; permissions: Permissions }) => void;
  togglePerm: (k: PermissionKey) => void;
  pending: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_2fr] gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tpl-label">Label</Label>
          <Input
            id="tpl-label"
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            placeholder="e.g. Lead Tech"
            disabled={pending}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tpl-desc">Description (optional)</Label>
          <Input
            id="tpl-desc"
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            placeholder="What this template is for"
            disabled={pending}
          />
        </div>
      </div>
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
                      checked={draft.permissions[k]}
                      onChange={() => togglePerm(k)}
                      disabled={pending || locked}
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
    </div>
  );
}
