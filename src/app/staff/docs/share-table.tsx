"use client";

import { useState, useTransition } from "react";
import { createShareAction, revokeShareAction } from "./actions";
import type { DocShare } from "@/lib/doc-shares";

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
  const [isPending, startTransition] = useTransition();

  const onSubmit = (formData: FormData) => {
    setError(null);
    setIssued(null);
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
      <section className="rounded-md border border-neutral-200 bg-white p-6">
        <h2 className="mb-4 text-base font-semibold tracking-tight">Mint a new link</h2>
        <form action={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Document">
            <select
              name="doc_key"
              required
              className="w-full rounded border border-neutral-300 bg-white px-3 py-2 text-sm"
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
              className="w-full rounded border border-neutral-300 bg-white px-3 py-2 text-sm"
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
              className="w-full rounded border border-neutral-300 bg-white px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Max views (optional)">
            <input
              name="max_views"
              type="number"
              min={1}
              placeholder="leave blank for unlimited"
              className="w-full rounded border border-neutral-300 bg-white px-3 py-2 text-sm"
            />
          </Field>
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={isPending}
              className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
            >
              {isPending ? "Minting…" : "Mint share link"}
            </button>
            {error ? (
              <span className="ml-4 text-sm text-red-600">{error}</span>
            ) : null}
          </div>
        </form>

        {/* ONE-TIME REVEAL */}
        {issued ? (
          <div className="mt-6 rounded-md border border-emerald-300 bg-emerald-50 p-4">
            <div className="mb-2 font-mono text-[11px] uppercase tracking-widest text-emerald-800">
              Show this once — copy now
            </div>
            <div className="flex items-center gap-3">
              <code className="flex-1 overflow-x-auto rounded bg-white p-2 text-xs">{issued.url}</code>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(issued.url)}
                className="rounded border border-emerald-300 bg-white px-3 py-2 text-xs font-medium hover:bg-emerald-100"
              >
                Copy
              </button>
            </div>
            <p className="mt-2 text-xs text-emerald-900/70">
              The token is hashed in the database. If you lose this URL, you'll need to revoke this
              link and mint a new one.
            </p>
          </div>
        ) : null}
      </section>

      {/* TABLE */}
      <section className="rounded-md border border-neutral-200 bg-white">
        <header className="border-b border-neutral-200 px-6 py-4">
          <h2 className="text-base font-semibold tracking-tight">Active &amp; historic links</h2>
          <p className="text-sm text-neutral-500">{shares.length} total</p>
        </header>
        {shares.length === 0 ? (
          <div className="px-6 py-10 text-sm text-neutral-500">
            No share links yet. Mint one above to start.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-neutral-50 text-left font-mono text-[10px] uppercase tracking-widest text-neutral-500">
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
                  <tr key={s.id} className="border-t border-neutral-100">
                    <td className="px-6 py-3 align-top font-mono text-xs">{s.doc_key}</td>
                    <td className="px-2 py-3 align-top text-neutral-700">{s.label ?? <em className="text-neutral-400">no label</em>}</td>
                    <td className="px-2 py-3 align-top">
                      <StatusPill status={status} />
                    </td>
                    <td className="px-2 py-3 align-top font-mono text-xs">
                      {s.view_count}{s.max_views ? ` / ${s.max_views}` : ""}
                    </td>
                    <td className="px-2 py-3 align-top text-xs text-neutral-600">
                      {s.expires_at ? new Date(s.expires_at).toLocaleString("en-GB") : "never"}
                    </td>
                    <td className="px-2 py-3 align-top text-xs text-neutral-600">
                      {s.last_viewed_at ? new Date(s.last_viewed_at).toLocaleString("en-GB") : "—"}
                    </td>
                    <td className="px-6 py-3 align-top text-right">
                      {status === "active" ? (
                        <button
                          type="button"
                          onClick={() => onRevoke(s.id)}
                          className="rounded border border-neutral-300 px-2 py-1 text-xs hover:border-red-300 hover:text-red-700"
                        >
                          Revoke
                        </button>
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
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-widest text-neutral-500">
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
    active: "bg-emerald-50 text-emerald-800 border-emerald-200",
    expired: "bg-neutral-100 text-neutral-700 border-neutral-200",
    revoked: "bg-red-50 text-red-700 border-red-200",
    exhausted: "bg-amber-50 text-amber-800 border-amber-200",
  };
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest ${tone[status]}`}>
      {status}
    </span>
  );
}
