import { PageHeader } from "@/components/staff/page-header";
import { RELEASE_NOTES, type ReleaseEntryKind } from "@/lib/release-notes";

const KIND_STYLE: Record<ReleaseEntryKind, { label: string; cls: string }> = {
  new: { label: "New", cls: "bg-green-950/60 text-green-300 border-green-800" },
  improved: { label: "Improved", cls: "bg-sky-950/60 text-sky-300 border-sky-800" },
  fixed: { label: "Fixed", cls: "bg-amber-950/50 text-amber-300 border-amber-800" },
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

export default function WhatsNewPage() {
  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <PageHeader
        title="What's new"
        description="Recent changes to AI Garage — new features, improvements and fixes."
      />

      {RELEASE_NOTES.map((release) => (
        <section key={release.version} className="rounded-xl border bg-card p-6">
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 className="font-mono text-lg font-bold">{release.version}</h2>
            <span className="text-xs text-muted-foreground">{fmtDate(release.date)}</span>
          </div>
          {release.summary && (
            <p className="mt-1 text-sm text-muted-foreground">{release.summary}</p>
          )}
          <ul className="mt-4 flex flex-col gap-3">
            {release.entries.map((entry, i) => {
              const kind = KIND_STYLE[entry.kind];
              return (
                <li key={i} className="flex items-start gap-3">
                  <span
                    className={`mt-0.5 w-[72px] flex-none rounded-full border px-2 py-0.5 text-center text-[10px] font-semibold uppercase tracking-wide ${kind.cls}`}
                  >
                    {kind.label}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{entry.title}</p>
                    {entry.body && (
                      <p className="mt-0.5 text-sm text-muted-foreground">{entry.body}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <p className="text-xs text-muted-foreground">
        Spotted a problem or want a feature? Use the Support button (top right) — feature requests
        the team adopts are marked planned on your ticket.
      </p>
    </div>
  );
}
