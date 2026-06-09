import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveTenantFromHost } from "@/lib/tenant";
import { PLATFORM_COMPONENTS } from "@/lib/platform/components";

// Public system-status page. Shows ONLY incidents the ops team has published
// (and only their public updates). No auth. Component statuses are derived from
// published, unresolved incidents until per-service synthetic checks land.
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

type Tone = "ok" | "warn" | "bad";
const sevTone = (sev: string): Tone => (sev === "SEV-1" || sev === "SEV-2" ? "bad" : "warn");
const rank: Record<Tone, number> = { ok: 0, warn: 1, bad: 2 };

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
  const { data } = await admin
    .from("incidents")
    .select("id, title, severity, status, components, started_at, incident_updates(status, body, created_at, public)")
    .eq("published", true)
    .is("resolved_at", null)
    .order("started_at", { ascending: false });

  const incidents = ((data ?? []) as PubIncident[]).map((i) => ({
    ...i,
    components: i.components ?? [],
    updates: (i.incident_updates ?? [])
      .filter((u) => u.public)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
  }));

  // Derive component statuses from published incidents.
  const compTone = new Map<string, Tone>();
  for (const c of PLATFORM_COMPONENTS) compTone.set(c, "ok");
  for (const inc of incidents) {
    const tone = sevTone(inc.severity);
    for (const c of inc.components) {
      if (compTone.has(c) && rank[tone] > rank[compTone.get(c)!]) compTone.set(c, tone);
    }
  }
  const worst = [...compTone.values()].reduce<Tone>((w, t) => (rank[t] > rank[w] ? t : w), "ok");

  const overall =
    worst === "ok"
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
        {incidents.length === 0 ? (
          <div className="mb-9 flex items-center gap-2.5 rounded-xl border border-[#23272f] bg-[#15181d] px-4 py-4 text-sm text-[#9aa1ad]">
            <span className="h-2 w-2 rounded-full bg-[#5fdd9d]" />
            No incidents reported. All systems have been stable.
          </div>
        ) : (
          <div className="mb-9 flex flex-col gap-4">
            {incidents.map((inc) => {
              const tone = sevTone(inc.severity);
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
                    Started {new Date(inc.started_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} GMT
                  </div>
                  {inc.updates.map((u, i) => (
                    <div key={i} className="grid grid-cols-[78px_1fr] gap-3.5 border-t border-[#23272f] py-2.5">
                      <div>
                        <div className={`text-[11px] font-bold uppercase tracking-wide ${UPDATE_TONE[u.status] ?? "text-[#c7ccd4]"}`}>{u.status}</div>
                        <div className="mt-0.5 font-mono text-[11px] text-[#5a6170]">
                          {new Date(u.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                        </div>
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
        <div className="overflow-hidden rounded-xl border border-[#23272f] bg-[#15181d]">
          {PLATFORM_COMPONENTS.map((c) => {
            const t = compTone.get(c)!;
            return (
              <div key={c} className="flex items-center gap-3 border-t border-[#23272f] px-[18px] py-3.5 first:border-t-0">
                <span className="text-sm font-medium">{c}</span>
                <span className={`ml-auto flex items-center gap-2 text-[12.5px] font-semibold ${textFor(t)}`}>
                  <span className={`h-2.5 w-2.5 rounded-full ${dotFor(t)}`} />
                  {labelFor(t)}
                </span>
              </div>
            );
          })}
        </div>

        <div className="mt-12 border-t border-[#23272f] pt-6 text-xs text-[#5a6170]">
          Updated{" "}
          <span className="font-mono">
            {new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
          </span>{" "}
          · all times GMT
        </div>
      </div>
    </div>
  );
}
