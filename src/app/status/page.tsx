import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveTenantFromHost } from "@/lib/tenant";
import { PLATFORM_COMPONENTS } from "@/lib/platform/components";
import { severityTone, summariseStatus, ukDateTime, ukTime, ukTimeWithZone, type StatusTone } from "@/lib/platform/status-summary";

// Public system-status page. Shows ONLY incidents the ops team has published
// (and only their public updates). No auth. Component statuses are derived from
// published, unresolved incidents until per-service synthetic checks land; the
// headline follows every published incident (see status-summary.ts).
// Root-domain only — not served on tenant subdomains or the admin host.
export const dynamic = "force-dynamic";

// Explicit AI Garage favicon + title (the root metadata icons weren't coming
// through on this standalone page). Title template makes it "System status ·
// AI Garage".
export const metadata: Metadata = {
  title: "System status",
  icons: {
    icon: [
      { url: "/brand/icon/aigarage-favicon.svg", type: "image/svg+xml" },
      { url: "/brand/icon/png/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/icon/png/favicon-192.png", sizes: "192x192", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
    apple: [{ url: "/brand/icon/png/apple-touch-icon.png", sizes: "180x180" }],
  },
};

type PubUpdate = { status: string; body: string; created_at: string; public: boolean };
type PubIncident = {
  id: string;
  title: string;
  severity: string;
  status: string;
  components: string[];
  started_at: string;
  incident_updates: PubUpdate[];
};

type Tone = StatusTone;

const UPDATE_TONE: Record<string, string> = {
  Investigating: "text-[#ff7b7b]",
  Identified: "text-[#f5c451]",
  Monitoring: "text-[#c7ccd4]",
  Resolved: "text-[#5fdd9d]",
};

export default async function StatusPage() {
  // Root domain only — tenant subdomains and the admin host 404.
  const h = await headers();
  const host = h.get("host") ?? h.get("x-forwarded-host") ?? "";
  if (!resolveTenantFromHost(host).isRootDomain) notFound();

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("incidents")
    .select("id, title, severity, status, components, started_at, incident_updates(status, body, created_at, public)")
    .eq("published", true)
    .is("resolved_at", null)
    .order("started_at", { ascending: false });
  // A failed read must never render as "All systems operational" — that is
  // the one message a status page can't get wrong, and a database problem is
  // exactly when this query is most likely to fail.
  const unavailable = !!error;
  if (error) console.error("[status] incidents query failed", error.message);

  const incidents = ((data ?? []) as PubIncident[]).map((i) => ({
    ...i,
    components: i.components ?? [],
    updates: (i.incident_updates ?? [])
      .filter((u) => u.public)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
  }));

  const summary = summariseStatus(incidents);
  const compTone = summary.components;
  const worst = summary.overall;

  const overall = unavailable
    ? { icon: "?", title: "Status temporarily unavailable", sub: "We couldn't load the latest status. Please try again in a few minutes.", border: "border-[#2a2f37]", from: "from-[#1b1f26]", color: "text-[#9aa1ad]" }
    : worst === "ok"
      ? { icon: "✓", title: "All systems operational", sub: "All AI Garage services are running normally.", border: "border-[#2a5a3a]", from: "from-[#13301f]", color: "text-[#5fdd9d]" }
      : worst === "warn"
        ? { icon: "!", title: "Some systems degraded", sub: "We're investigating an issue affecting some services.", border: "border-[#5a4a1f]", from: "from-[#2e2410]", color: "text-[#f5c451]" }
        : { icon: "✕", title: "Major service outage", sub: "We're working to restore affected services.", border: "border-[#5a2424]", from: "from-[#3a1a1a]", color: "text-[#ff7b7b]" };

  const dotFor = (t: Tone) => (t === "ok" ? "bg-[#5fdd9d]" : t === "warn" ? "bg-[#f5c451]" : "bg-[#ff7b7b]");
  const labelFor = (t: Tone) => (t === "ok" ? "Operational" : t === "warn" ? "Degraded performance" : "Major outage");
  const textFor = (t: Tone) => (t === "ok" ? "text-[#5fdd9d]" : t === "warn" ? "text-[#f5c451]" : "text-[#ff7b7b]");

  return (
    <div className="min-h-screen bg-[#0f1115] text-[#e6e8eb]">
      <div className="mx-auto max-w-[760px] px-6 pb-20 pt-12">
        <div className="mb-9 flex items-center gap-3">
          <div className="text-[17px] font-bold leading-tight">
            AI Garage
            <span className="block text-[11px] font-medium text-[#5a6170]">System status</span>
          </div>
        </div>

        <div className={`mb-8 flex items-center gap-4 rounded-2xl border bg-gradient-to-r to-[#15181d] px-5 py-5 ${overall.border} ${overall.from}`}>
          <div className={`grid h-9 w-9 place-items-center rounded-full text-lg ${overall.color}`}>{overall.icon}</div>
          <div>
            <div className="text-lg font-semibold">{overall.title}</div>
            <div className="mt-0.5 text-sm text-[#9aa1ad]">{overall.sub}</div>
          </div>
        </div>

        <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-[#5a6170]">Active incidents</h2>
        {unavailable ? (
          <div className="mb-9 flex items-center gap-2.5 rounded-xl border border-[#23272f] bg-[#15181d] px-4 py-4 text-sm text-[#9aa1ad]">
            <span className="h-2 w-2 rounded-full bg-[#9aa1ad]" />
            Incident details couldn&apos;t be loaded right now.
          </div>
        ) : incidents.length === 0 ? (
          <div className="mb-9 flex items-center gap-2.5 rounded-xl border border-[#23272f] bg-[#15181d] px-4 py-4 text-sm text-[#9aa1ad]">
            <span className="h-2 w-2 rounded-full bg-[#5fdd9d]" />
            No incidents reported. All systems have been stable.
          </div>
        ) : (
          <div className="mb-9 flex flex-col gap-4">
            {incidents.map((inc) => {
              const tone = severityTone(inc.severity);
              return (
                <div
                  key={inc.id}
                  className={`rounded-xl border border-l-[3px] border-[#23272f] bg-[#15181d] px-5 py-4 ${tone === "bad" ? "border-l-[#ff7b7b]" : "border-l-[#f5c451]"}`}
                >
                  <div className="mb-1 flex items-center gap-2.5">
                    <span className="text-base font-semibold">{inc.title}</span>
                    <span className={`rounded border px-2 py-0.5 font-mono text-[10px] font-bold ${tone === "bad" ? "border-[#5a2424] bg-[#3a1a1a] text-[#ff7b7b]" : "border-[#5a4a1f] bg-[#2e2410] text-[#f5c451]"}`}>
                      {tone === "bad" ? "Major" : "Minor"}
                    </span>
                  </div>
                  <div className="mb-3 font-mono text-xs text-[#5a6170]">
                    Started {ukDateTime(inc.started_at)}
                    {inc.components.length > 0 && <> · Affects {inc.components.join(", ")}</>}
                  </div>
                  {inc.updates.map((u, i) => (
                    <div key={i} className="grid grid-cols-[108px_1fr] gap-3.5 border-t border-[#23272f] py-2.5">
                      <div>
                        <div className={`text-[11px] font-bold uppercase tracking-wide ${UPDATE_TONE[u.status] ?? "text-[#c7ccd4]"}`}>{u.status}</div>
                        <div className="mt-0.5 font-mono text-[11px] text-[#5a6170]">{ukTime(u.created_at)}</div>
                      </div>
                      <div className="text-[13.5px] leading-relaxed text-[#c7ccd4]">{u.body}</div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}

        <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-[#5a6170]">Current status</h2>
        {!unavailable && summary.unmapped && (
          <p className="mb-3 text-[13px] text-[#9aa1ad]">
            We&apos;re still confirming which services an active incident affects — see Active incidents above.
          </p>
        )}
        <div className="overflow-hidden rounded-xl border border-[#23272f] bg-[#15181d]">
          {PLATFORM_COMPONENTS.map((c) => {
            const t = compTone.get(c)!;
            return (
              <div key={c} className="flex items-center gap-3 border-t border-[#23272f] px-[18px] py-3.5 first:border-t-0">
                <span className="text-sm font-medium">{c}</span>
                {unavailable ? (
                  <span className="ml-auto text-[12.5px] font-semibold text-[#9aa1ad]">Unknown</span>
                ) : (
                  <span className={`ml-auto flex items-center gap-2 text-[12.5px] font-semibold ${textFor(t)}`}>
                    <span className={`h-2.5 w-2.5 rounded-full ${dotFor(t)}`} />
                    {labelFor(t)}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-12 border-t border-[#23272f] pt-6 text-xs text-[#5a6170]">
          Updated <span className="font-mono">{ukTimeWithZone(new Date())}</span> · all times UK time
        </div>
      </div>
    </div>
  );
}
