"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AigSpinner } from "@/components/ui/aig-spinner";
import { PLATFORM_COMPONENTS } from "@/lib/platform/components";
import type { Incident } from "@/lib/platform/incidents";
import {
  declareIncident,
  addIncidentUpdate,
  setIncidentPublished,
  ackIncident,
} from "@/app/admin/health/incident-actions";

const SEVERITIES = ["SEV-1", "SEV-2", "SEV-3", "SEV-4"] as const;
const STATUSES = ["Investigating", "Identified", "Monitoring", "Resolved"] as const;

function sevTone(sev: string): "bad" | "warn" | "info" {
  return sev === "SEV-1" || sev === "SEV-2" ? "bad" : sev === "SEV-3" ? "warn" : "info";
}
const TONE_BADGE: Record<string, string> = {
  bad: "text-[#ff7b7b] bg-[#3a1a1a] border-[#5a2424]",
  warn: "text-[#f5c451] bg-[#2e2410] border-[#5a4a1f]",
  info: "text-[#7aa2ff] bg-[#1c2740] border-[#2c3c63]",
};
const TONE_BORDER: Record<string, string> = {
  bad: "border-l-[#ff7b7b]",
  warn: "border-l-[#f5c451]",
  info: "border-l-[#7aa2ff]",
};

export function IncidentsPanel({ incidents }: { incidents: Incident[] }) {
  const router = useRouter();
  const [declareOpen, setDeclareOpen] = useState(false);
  const refresh = () => router.refresh();

  const top = incidents[0];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Incidents</h2>
        <button
          type="button"
          onClick={() => setDeclareOpen(true)}
          className="rounded-lg border border-[#5a2424] bg-[#3a1a1a] px-3 py-1.5 text-xs font-semibold text-[#ff7b7b] hover:bg-[#4a2020]"
        >
          Declare incident
        </button>
      </div>

      {/* Banner */}
      {!top ? (
        <div className="flex items-center gap-3 rounded-xl border border-[#2a5a3a] bg-gradient-to-r from-[#13301f] to-[#15181d] px-4 py-3 text-sm">
          <span className="h-2 w-2 rounded-full bg-[#5fdd9d]" />
          <span>
            <b>All systems operational.</b> No active incidents.
          </span>
        </div>
      ) : (
        <div
          className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-sm ${
            sevTone(top.severity) === "bad" ? "border-[#5a2424] bg-gradient-to-r from-[#3a1a1a] to-[#15181d]" : "border-[#5a4a1f] bg-gradient-to-r from-[#2e2410] to-[#15181d]"
          }`}
        >
          <span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-bold ${TONE_BADGE[sevTone(top.severity)]}`}>
            {top.severity}
          </span>
          <b>{top.title}</b>
          <span className="font-mono text-xs text-[#9aa1ad]">· {top.status}</span>
          {incidents.length > 1 && (
            <span className="ml-auto text-xs text-[#9aa1ad]">+{incidents.length - 1} other active</span>
          )}
        </div>
      )}

      {/* Cards */}
      {incidents.map((inc) => (
        <IncidentCard key={inc.id} inc={inc} onChange={refresh} />
      ))}

      {declareOpen && <DeclareModal onClose={() => setDeclareOpen(false)} onDone={refresh} />}
    </div>
  );
}

function IncidentCard({ inc, onChange }: { inc: Incident; onChange: () => void }) {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<string>(inc.status);
  const [body, setBody] = useState("");
  const [isPublic, setIsPublic] = useState(inc.published);
  const [err, setErr] = useState<string | null>(null);
  const tone = sevTone(inc.severity);

  function run(fn: () => Promise<{ error: string } | { success: true }>) {
    setErr(null);
    startTransition(async () => {
      const r = await fn();
      if ("error" in r) setErr(r.error);
      else onChange();
    });
  }

  function submitUpdate() {
    if (!body.trim()) {
      setErr("Update text is required.");
      return;
    }
    const fd = new FormData();
    fd.set("incidentId", inc.id);
    fd.set("status", status);
    fd.set("body", body);
    if (isPublic) fd.set("public", "on");
    run(async () => {
      const r = await addIncidentUpdate(fd);
      if ("success" in r) setBody("");
      return r;
    });
  }

  return (
    <div className={`rounded-xl border border-l-[3px] border-[#23272f] bg-[#15181d] p-4 ${TONE_BORDER[tone]}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-bold ${TONE_BADGE[tone]}`}>{inc.severity}</span>
        <span className="font-semibold">{inc.title}</span>
        {inc.auto_declared && <span className="font-mono text-[10px] text-[#9aa1ad]">auto</span>}
        {inc.published && <span className="font-mono text-[10px] text-[#7aa2ff]">published</span>}
        <span className="ml-auto font-mono text-[11px] text-[#5a6170]">{inc.ref}</span>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2 font-mono text-[11px] text-[#9aa1ad]">
        <span className={`rounded border px-1.5 py-0.5 text-[10px] ${TONE_BADGE[inc.status === "Monitoring" ? "warn" : tone]}`}>{inc.status}</span>
        <span>started {new Date(inc.started_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
        {inc.components.map((c) => (
          <span key={c} className="rounded border border-[#2a2f37] bg-[#171b21] px-1.5 py-0.5 text-[10px] text-[#c7ccd4]">
            {c}
          </span>
        ))}
      </div>

      {/* Controls */}
      <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-[#23272f] pb-3">
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => setIncidentPublished(inc.id, !inc.published))}
          className={`rounded border px-2.5 py-1 text-xs ${inc.published ? "border-[#2a5a3a] bg-[#13301f] text-[#5fdd9d]" : "border-[#2a2f37] text-[#9aa1ad] hover:text-white"}`}
        >
          {inc.published ? "Published to /status" : "Publish to /status"}
        </button>
        {!inc.acked_at && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => ackIncident(inc.id))}
            className="rounded border border-[#2a2f37] px-2.5 py-1 text-xs text-[#9aa1ad] hover:text-white"
          >
            Acknowledge
          </button>
        )}
        {inc.acked_at && <span className="font-mono text-[11px] text-[#5fdd9d]">acked</span>}
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            const fd = new FormData();
            fd.set("incidentId", inc.id);
            fd.set("status", "Resolved");
            fd.set("body", "Resolved.");
            if (inc.published) fd.set("public", "on");
            run(() => addIncidentUpdate(fd));
          }}
          className="ml-auto rounded border border-[#2a5a3a] bg-[#13301f] px-2.5 py-1 text-xs font-semibold text-[#5fdd9d] hover:bg-[#163a26]"
        >
          Resolve
        </button>
      </div>

      {/* Timeline */}
      <div className="flex flex-col">
        {inc.updates.map((u) => (
          <div key={u.id} className="grid grid-cols-[92px_1fr] gap-3 border-t border-[#23272f] py-2 first:border-t-0">
            <div>
              <div className="text-[11px] font-semibold text-[#c7ccd4]">{u.status}</div>
              <div className="font-mono text-[11px] text-[#5a6170]">
                {new Date(u.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                {u.public && <span className="ml-1 text-[#7aa2ff]">·public</span>}
              </div>
            </div>
            <div className="text-[12.5px] leading-relaxed text-[#c7ccd4]">{u.body}</div>
          </div>
        ))}
      </div>

      {/* Composer */}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#23272f] pt-3">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded border border-[#2a2f37] bg-[#171b21] px-2 py-1.5 text-xs text-white outline-none"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Post an update…"
          className="min-w-[200px] flex-1 rounded border border-[#2a2f37] bg-[#171b21] px-3 py-1.5 text-sm text-white placeholder:text-[#5a6170] focus:border-[#22c55e] focus:outline-none"
        />
        <label className="flex items-center gap-1.5 text-xs text-[#9aa1ad]">
          <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
          public
        </label>
        <button
          type="button"
          disabled={pending}
          onClick={submitUpdate}
          className="inline-flex items-center gap-2 rounded border border-[#2a2f37] bg-[#171b21] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1b2027] disabled:opacity-60"
        >
          {pending && <AigSpinner />}
          Add
        </button>
      </div>
      {err && <p className="mt-2 text-xs text-red-400">{err}</p>}
    </div>
  );
}

function DeclareModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [pending, startTransition] = useTransition();
  const [severity, setSeverity] = useState<string>("SEV-3");
  const [components, setComponents] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);

  function toggleComp(c: string) {
    setComponents((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    const fd = new FormData(e.currentTarget);
    fd.set("severity", severity);
    fd.delete("components");
    for (const c of components) fd.append("components", c);
    startTransition(async () => {
      const r = await declareIncident(fd);
      if ("error" in r) setErr(r.error);
      else {
        onDone();
        onClose();
      }
    });
  }

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/70 p-6 backdrop-blur-sm" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="flex max-h-[90vh] w-[540px] max-w-[96vw] flex-col gap-4 overflow-y-auto rounded-2xl border border-[#2a2f37] bg-[#15181d] p-6"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">Declare incident</h3>
          <button type="button" onClick={onClose} className="text-[#9aa1ad] hover:text-white">
            ✕
          </button>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[#5a6170]">Title</span>
          <input
            name="title"
            required
            placeholder="Short summary"
            className="rounded-lg border border-[#2a2f37] bg-[#171b21] px-3 py-2 text-sm text-white placeholder:text-[#5a6170] focus:border-[#22c55e] focus:outline-none"
          />
        </label>

        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[#5a6170]">Severity</span>
          <div className="flex gap-2">
            {SEVERITIES.map((s) => {
              const on = severity === s;
              const tone = sevTone(s);
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSeverity(s)}
                  className={`flex-1 rounded-lg border px-2 py-2 font-mono text-xs font-semibold ${on ? TONE_BADGE[tone] : "border-[#2a2f37] bg-[#171b21] text-[#9aa1ad] hover:text-white"}`}
                >
                  {s}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[#5a6170]">Affected components</span>
          <div className="flex flex-wrap gap-2">
            {PLATFORM_COMPONENTS.map((c) => {
              const on = components.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggleComp(c)}
                  className={`rounded-md border px-2.5 py-1 text-[11.5px] ${on ? "border-[#2c3c63] bg-[#1c2740] text-[#7aa2ff]" : "border-[#2a2f37] bg-[#171b21] text-[#9aa1ad] hover:text-white"}`}
                >
                  {c}
                </button>
              );
            })}
          </div>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[#5a6170]">Initial update</span>
          <textarea
            name="body"
            required
            rows={3}
            placeholder="What's happening + what's the impact?"
            className="rounded-lg border border-[#2a2f37] bg-[#171b21] px-3 py-2 text-sm text-white placeholder:text-[#5a6170] focus:border-[#22c55e] focus:outline-none"
          />
        </label>

        <label className="flex items-center gap-2 text-sm text-[#c7ccd4]">
          <input type="checkbox" name="published" />
          Publish to the public status page now
        </label>

        {err && <p className="text-xs text-red-400">{err}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-[#2a2f37] px-3 py-2 text-sm text-[#9aa1ad] hover:text-white">
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-lg border border-[#5a2424] bg-[#3a1a1a] px-4 py-2 text-sm font-semibold text-[#ff7b7b] hover:bg-[#4a2020] disabled:opacity-60"
          >
            {pending && <AigSpinner />}
            Declare
          </button>
        </div>
      </form>
    </div>
  );
}
