"use client";

import { useState, useTransition } from "react";
import { createShareAction, revokeShareAction } from "./actions";
import type { DocShare } from "@/lib/doc-shares";
import { Button } from "@/components/ui/button";

const DOC_OPTIONS = [
  { value: "technical", label: "Technical reference" },
  // Add more entries here as DOC_MAP in route.ts grows.
];

const EXPIRY_OPTIONS = [
  { value: "1", label: "24 hours" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "never", label: "Never (not recommended)" },
];

export function ShareManager({ shares }: { shares: DocShare[] }) {
  const [issued, setIssued] = useState<{ url: string; slug: string; createdAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();

  const onSubmit = (formData: FormData) => {
    setError(null);
    setIssued(null);
    setCopied(false);
    startTransition(async () => {
      const res = await createShareAction(formData);
      if (res.ok) {
        setIssued({ url: res.url, slug: res.slug, createdAt: new Date().toISOString() });
      } else {
        setError(res.error);
      }
    });
  };

  const onRevoke = (id: string) => {
    if (!confirm("Revoke this share link? Anyone holding it will get a 410 Gone page from now on.")) return;
    startTransition(async () => {
      const res = await revokeShareAction(id);
      if (!res.ok) setError(res.error);
    });
  };

  return (
    <div className="space-y-8">
      {/* MINT FORM */}
      <section className="rounded-md border border-border bg-card p-6">
        <h2 className="mb-4 text-base font-semibold tracking-tight">Mint a new link</h2>
        <form action={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Document">
            <select
              name="doc_key"
              required
              className="w-full rounded border border-input bg-background px-3 py-2 text-sm text-foreground"
              defaultValue="technical"
            >
              {DOC_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Expires after">
            <select
              name="expires_in_days"
              className="w-full rounded border border-input bg-background px-3 py-2 text-sm text-foreground"
              defaultValue="7"
            >
              {EXPIRY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Label (only you see this)">
            <input
              name="label"
              type="text"
              maxLength={120}
              placeholder="e.g. Sent to John @ Acme · CTO review"
              className="w-full rounded border border-input bg-background px-3 py-2 text-sm text-foreground"
            />
          </Field>
          <Field label="Max views (optional)">
            <input
              name="max_views"
              type="number"
              min={1}
              placeholder="leave blank for unlimited"
              className="w-full rounded border border-input bg-background px-3 py-2 text-sm text-foreground"
            />
          </Field>
          <div className="sm:col-span-2 flex items-center">
            <Button type="submit" disabled={isPending}>
              {isPending ? "Minting…" : "Mint share link"}
            </Button>
            {error ? (
              <span className="ml-4 text-sm text-red-600">{error}</span>
            ) : null}
          </div>
        </form>

        {/* ONE-TIME REVEAL */}
        {issued ? (
          <div className="mt-6 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-4">
            <div className="mb-2 font-mono text-[11px] uppercase tracking-widest text-emerald-400">
              Show this once — copy now
            </div>
            <div className="flex items-center gap-3">
              <code className="flex-1 overflow-x-auto rounded border border-border bg-background p-2 text-xs text-foreground">{issued.url}</code>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  navigator.clipboard.writeText(issued.url);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                {copied ? "Copied ✓" : "Copy"}
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              The token is hashed in the database. If you lose this URL, you&apos;ll need to revoke this
              link and mint a new one.
            </p>
          </div>
        ) : null}
      </section>

      {/* TABLE */}
      <section className="rounded-md border border-border bg-card">
        <header className="border-b border-border px-6 py-4">
          <h2 className="text-base font-semibold tracking-tight">Active &amp; historic links</h2>
          <p className="text-sm text-muted-foreground">{shares.length} total</p>
        </header>
        {shares.length === 0 ? (
          <div className="px-6 py-10 text-sm text-muted-foreground">
            No share links yet. Mint one above to start.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted text-left font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                <th className="px-6 py-2 font-medium">Doc</th>
                <th className="px-2 py-2 font-medium">Label</th>
                <th className="px-2 py-2 font-medium">Status</th>
                <th className="px-2 py-2 font-medium">Views</th>
                <th className="px-2 py-2 font-medium">Expires</th>
                <th className="px-2 py-2 font-medium">Last viewed</th>
                <th className="px-6 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {shares.map((s) => {
                const status = shareStatus(s);
                return (
                  <tr key={s.id} className="border-t border-border">
                    <td className="px-6 py-3 align-top font-mono text-xs">{s.doc_key}</td>
                    <td className="px-2 py-3 align-top text-foreground">{s.label ?? <em className="text-muted-foreground">no label</em>}</td>
                    <td className="px-2 py-3 align-top">
                      <StatusPill status={status} />
                    </td>
                    <td className="px-2 py-3 align-top font-mono text-xs">
                      {s.view_count}{s.max_views ? ` / ${s.max_views}` : ""}
                    </td>
                    <td className="px-2 py-3 align-top text-xs text-muted-foreground">
                      {s.expires_at ? new Date(s.expires_at).toLocaleString("en-GB") : "never"}
                    </td>
                    <td className="px-2 py-3 align-top text-xs text-muted-foreground">
                      {s.last_viewed_at ? new Date(s.last_viewed_at).toLocaleString("en-GB") : "—"}
                    </td>
                    <td className="px-6 py-3 align-top text-right">
                      {status === "active" ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="xs"
                          onClick={() => onRevoke(s.id)}
                          className="hover:border-destructive/40 hover:text-destructive"
                        >
                          Revoke
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

// --- small ui helpers ------------------------------------------------------

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

type ShareStatus = "active" | "expired" | "revoked" | "exhausted";

function shareStatus(s: DocShare): ShareStatus {
  if (s.revoked_at) return "revoked";
  if (s.expires_at && new Date(s.expires_at) <= new Date()) return "expired";
  if (s.max_views !== null && s.view_count >= s.max_views) return "exhausted";
  return "active";
}

function StatusPill({ status }: { status: ShareStatus }) {
  const tone: Record<ShareStatus, string> = {
    active: "bg-green-50 text-green-700 border-green-200",
    expired: "bg-muted text-muted-foreground border-border",
    revoked: "bg-red-50 text-red-700 border-red-200",
    exhausted: "bg-amber-50 text-amber-800 border-amber-200",
  };
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest ${tone[status]}`}>
      {status}
    </span>
  );
}
