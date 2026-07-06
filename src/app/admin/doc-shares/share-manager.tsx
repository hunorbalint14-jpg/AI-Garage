"use client";

import { useState, useTransition } from "react";
import { createShareAction, revokeShareAction } from "./actions";
import type { DocShare } from "@/lib/doc-shares";
import { useConfirm } from "@/components/confirm-provider";

const DOC_OPTIONS = [
  { value: "technical", label: "Technical reference" },
  { value: "userguide", label: "User manual (full)" },
  { value: "userguide-customer", label: "User manual (customer-only)" },
  // Add more entries here as DOC_MAP in src/app/docs/[slug]/route.ts grows.
];

const EXPIRY_OPTIONS = [
  { value: "1", label: "24 hours" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "never", label: "Never (not recommended)" },
];

const inputCls =
  "w-full rounded-lg border border-[#2a2f37] bg-[#0f1115] px-3 py-2 text-sm text-[#e6e8eb] placeholder:text-[#5a6170] focus:border-[#3a4a3f] focus:outline-none";

export function ShareManager({ shares }: { shares: DocShare[] }) {
  const confirm = useConfirm();
  const [issued, setIssued] = useState<{ url: string; slug: string } | null>(null);
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
        setIssued({ url: res.url, slug: res.slug });
      } else {
        setError(res.error);
      }
    });
  };

  const onRevoke = async (id: string) => {
    const ok = await confirm({
      title: "Revoke this share link?",
      description: "Anyone holding it gets a 410 Gone page from now on.",
      confirmLabel: "Revoke link",
      destructive: true,
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await revokeShareAction(id);
      if (!res.ok) setError(res.error);
    });
  };

  return (
    <div className="flex flex-col gap-6">
      {/* MINT FORM */}
      <section className="rounded-xl border border-[#23272f] bg-[#15181d] p-5">
        <h2 className="mb-4 text-sm font-semibold">Mint a new link</h2>
        <form action={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Document">
            <select name="doc_key" required className={inputCls} defaultValue="technical">
              {DOC_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Expires after">
            <select name="expires_in_days" className={inputCls} defaultValue="7">
              {EXPIRY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Label (only admins see this)">
            <input
              name="label"
              type="text"
              maxLength={120}
              placeholder="e.g. Sent to John @ Acme · CTO review"
              className={inputCls}
            />
          </Field>
          <Field label="Max views (optional)">
            <input
              name="max_views"
              type="number"
              min={1}
              placeholder="leave blank for unlimited"
              className={inputCls}
            />
          </Field>
          <div className="flex items-center gap-4 sm:col-span-2">
            <button
              type="submit"
              disabled={isPending}
              className="rounded-lg border border-[#2a5a3a] bg-[#13301f] px-3.5 py-2 text-sm font-semibold text-[#5fdd9d] transition-colors hover:bg-[#17402a] disabled:opacity-50"
            >
              {isPending ? "Minting…" : "Mint share link"}
            </button>
            {error ? <span className="text-sm text-[#ff7b7b]">{error}</span> : null}
          </div>
        </form>

        {/* ONE-TIME REVEAL */}
        {issued ? (
          <div className="mt-5 rounded-lg border border-[#2a5a3a] bg-[#13301f] p-4">
            <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.16em] text-[#5fdd9d]">
              Shown once — copy now
            </div>
            <div className="flex items-center gap-3">
              <code className="flex-1 overflow-x-auto rounded-lg border border-[#23272f] bg-[#0f1115] p-2 font-mono text-xs text-[#e6e8eb]">
                {issued.url}
              </code>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(issued.url);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="rounded-lg border border-[#2a2f37] px-2.5 py-1.5 text-xs font-semibold text-[#c7ccd4] transition-colors hover:bg-white/[0.04] hover:text-white"
              >
                {copied ? "Copied ✓" : "Copy"}
              </button>
            </div>
            <p className="mt-2 text-xs text-[#9aa1ad]">
              The token is hashed in the database. If you lose this URL, revoke the link and mint
              a new one.
            </p>
          </div>
        ) : null}
      </section>

      {/* TABLE */}
      <section className="overflow-hidden rounded-xl border border-[#23272f] bg-[#15181d]">
        <header className="border-b border-[#23272f] px-5 py-4">
          <h2 className="text-sm font-semibold">Active &amp; historic links</h2>
          <p className="mt-0.5 font-mono text-[10.5px] text-[#5a6170]">{shares.length} total</p>
        </header>
        {shares.length === 0 ? (
          <div className="px-5 py-10 text-sm text-[#5a6170]">
            No share links yet. Mint one above to start.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#171b21] text-left font-mono text-[10px] uppercase tracking-[0.14em] text-[#5a6170]">
                  <th className="px-5 py-2 font-medium">Doc</th>
                  <th className="px-2 py-2 font-medium">Label</th>
                  <th className="px-2 py-2 font-medium">Scope</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                  <th className="px-2 py-2 font-medium">Views</th>
                  <th className="px-2 py-2 font-medium">Expires</th>
                  <th className="px-2 py-2 font-medium">Last viewed</th>
                  <th className="px-5 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {shares.map((s) => {
                  const status = shareStatus(s);
                  return (
                    <tr key={s.id} className="border-t border-[#23272f]">
                      <td className="px-5 py-3 align-top font-mono text-xs text-[#e6e8eb]">{s.doc_key}</td>
                      <td className="px-2 py-3 align-top text-[#c7ccd4]">
                        {s.label ?? <em className="text-[#5a6170]">no label</em>}
                      </td>
                      <td className="px-2 py-3 align-top font-mono text-[10.5px] text-[#9aa1ad]">
                        {/* Legacy rows minted by garage owners before management moved here. */}
                        {s.organization_id ? "org (legacy)" : "platform"}
                      </td>
                      <td className="px-2 py-3 align-top">
                        <StatusPill status={status} />
                      </td>
                      <td className="px-2 py-3 align-top font-mono text-xs text-[#c7ccd4]">
                        {s.view_count}{s.max_views ? ` / ${s.max_views}` : ""}
                      </td>
                      <td className="px-2 py-3 align-top text-xs text-[#9aa1ad]">
                        {s.expires_at ? new Date(s.expires_at).toLocaleString("en-GB") : "never"}
                      </td>
                      <td className="px-2 py-3 align-top text-xs text-[#9aa1ad]">
                        {s.last_viewed_at ? new Date(s.last_viewed_at).toLocaleString("en-GB") : "—"}
                      </td>
                      <td className="px-5 py-3 align-top text-right">
                        {status === "active" ? (
                          <button
                            type="button"
                            onClick={() => onRevoke(s.id)}
                            className="rounded-lg border border-[#2a2f37] px-2.5 py-1 text-xs text-[#9aa1ad] transition-colors hover:border-[#5a2424] hover:bg-[#3a1a1a]/40 hover:text-[#ff7b7b]"
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
          </div>
        )}
      </section>
    </div>
  );
}

// --- small ui helpers ------------------------------------------------------

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.14em] text-[#5a6170]">
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
    active: "border-[#2a5a3a] bg-[#13301f] text-[#5fdd9d]",
    expired: "border-[#2a2f37] bg-[#171b21] text-[#9aa1ad]",
    revoked: "border-[#5a2424] bg-[#3a1a1a] text-[#ff7b7b]",
    exhausted: "border-[#5a4a1f] bg-[#2e2410] text-[#f5c451]",
  };
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] ${tone[status]}`}>
      {status}
    </span>
  );
}
