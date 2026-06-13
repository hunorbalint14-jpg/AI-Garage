"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { saveSermiStatus } from "./sermi-actions";

const INPUT_CLASS =
  "w-full rounded-md border border-black/20 dark:border-white/25 bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";

export type SermiView = {
  status: "not_applied" | "applied" | "accredited" | "lapsed";
  reference: string;
  expiresAt: string;
  notes: string;
};

const STATUS_META: Record<SermiView["status"], { label: string; chip: string }> = {
  not_applied: { label: "Not applied", chip: "bg-gray-100 text-gray-600" },
  applied: { label: "Application in progress", chip: "bg-blue-100 text-blue-700" },
  accredited: { label: "Accredited", chip: "bg-green-100 text-green-700" },
  lapsed: { label: "Lapsed", chip: "bg-red-100 text-red-700" },
};

export function SermiCard({ sermi, canManage }: { sermi: SermiView; canManage: boolean }) {
  const [status, setStatus] = useState<SermiView["status"]>(sermi.status);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await saveSermiStatus(formData);
      if ("error" in result) setError(result.error);
      else {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    });
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            SERMI accreditation
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Required since April 2026 to access security-related repair and maintenance
            information (keys, immobilisers, alarm coding). Apply via the SERMI conformity
            assessment body for the UK.
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_META[status].chip}`}>
          {STATUS_META[status].label}
        </span>
      </div>

      <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-4">
        <label className="text-xs text-muted-foreground">
          Status
          <select
            name="status"
            className={`${INPUT_CLASS} mt-1`}
            value={status}
            onChange={(e) => setStatus(e.target.value as SermiView["status"])}
            disabled={!canManage || pending}
          >
            {Object.entries(STATUS_META).map(([value, meta]) => (
              <option key={value} value={value}>{meta.label}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted-foreground">
          Reference / certificate no.
          <input name="reference" defaultValue={sermi.reference} className={`${INPUT_CLASS} mt-1`} disabled={!canManage || pending} />
        </label>
        <label className="text-xs text-muted-foreground">
          Expires
          <input type="date" name="expiresAt" defaultValue={sermi.expiresAt} className={`${INPUT_CLASS} mt-1`} disabled={!canManage || pending} />
        </label>
        <label className="text-xs text-muted-foreground">
          Notes
          <input name="notes" defaultValue={sermi.notes} className={`${INPUT_CLASS} mt-1`} disabled={!canManage || pending} />
        </label>
        {canManage && (
          <div className="sm:col-span-4">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Saving…" : saved ? "Saved" : "Save SERMI status"}
            </Button>
          </div>
        )}
      </form>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </section>
  );
}
