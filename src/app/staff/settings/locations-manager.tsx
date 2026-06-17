"use client";

import { useState, useTransition } from "react";
import { renameLocation, setPrimaryLocation } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Loc = { id: string; slug: string; name: string; address: string | null };

// Settings → Locations: edit a branch's name + postal address and choose the
// org's primary branch. The address prints on every client-facing comm, so a
// customer knows which site to attend. Slug/subdomain edits are intentionally
// absent (platform-admin-only).
export function LocationsManager({
  locations,
  primaryLocationId,
  canManage,
  rootHost,
}: {
  locations: Loc[];
  primaryLocationId: string | null;
  canManage: boolean;
  rootHost: string;
}) {
  const [pending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftAddress, setDraftAddress] = useState("");
  const [error, setError] = useState<string | null>(null);

  function startEdit(l: Loc) {
    setError(null);
    setEditingId(l.id);
    setDraftName(l.name);
    setDraftAddress(l.address ?? "");
  }

  function saveRename(id: string) {
    const name = draftName.trim();
    if (!name) {
      setError("Name can't be empty.");
      return;
    }
    setError(null);
    const fd = new FormData();
    fd.set("locationId", id);
    fd.set("name", name);
    fd.set("address", draftAddress.trim());
    startTransition(async () => {
      const res = await renameLocation(fd);
      if ("error" in res) setError(res.error);
      else setEditingId(null);
    });
  }

  function makePrimary(id: string) {
    setError(null);
    const fd = new FormData();
    fd.set("locationId", id);
    startTransition(async () => {
      const res = await setPrimaryLocation(fd);
      if ("error" in res) setError(res.error);
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      {error && <p className="text-sm text-red-600">{error}</p>}
      {locations.map((l) => {
        const isPrimary = l.id === primaryLocationId;
        const editing = editingId === l.id;
        return (
          <div
            key={l.id}
            className="flex flex-col gap-2 rounded-md border px-3 py-2 text-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                {editing ? (
                  <Input
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    disabled={pending}
                    className="h-8 max-w-xs"
                    autoFocus
                  />
                ) : (
                  <span className="truncate font-medium">{l.name}</span>
                )}
                {isPrimary && (
                  <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                    Primary
                  </span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
                  {l.slug}.{rootHost}
                </span>
                {canManage &&
                  (editing ? (
                    <>
                      <Button type="button" size="sm" loading={pending} onClick={() => saveRename(l.id)}>
                        Save
                      </Button>
                      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setEditingId(null)}>
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => startEdit(l)}>
                        Edit
                      </Button>
                      {!isPrimary && (
                        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => makePrimary(l.id)}>
                          Set primary
                        </Button>
                      )}
                    </>
                  ))}
              </div>
            </div>

            {editing ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`addr-${l.id}`} className="text-xs text-muted-foreground">
                  Address (shown on customer emails, SMS &amp; WhatsApp)
                </Label>
                <textarea
                  id={`addr-${l.id}`}
                  value={draftAddress}
                  onChange={(e) => setDraftAddress(e.target.value)}
                  disabled={pending}
                  rows={3}
                  placeholder={"12 High Street\nCamden\nNW1 0AB"}
                  className="w-full resize-none rounded-md border border-black/20 bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 dark:border-white/25"
                />
              </div>
            ) : (
              <p className="whitespace-pre-line text-xs text-muted-foreground">
                {l.address?.trim() ? l.address : "No address set — add one so it shows on customer confirmations."}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
