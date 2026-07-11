"use client";

import { useState, useTransition } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { saveSiteSettings } from "./site-actions";
import type { MiniSiteSectionKey } from "@/lib/minisite-data";

// Mini-site settings (#507 PR 2): publish toggle, section toggles, copy
// fields. AI drafting arrives in PR 4 — the fields are plain textareas here.

const SECTIONS: { key: MiniSiteSectionKey; label: string; blurb: string }[] = [
  { key: "services", label: "Services & prices", blurb: "Active services with from-prices." },
  { key: "hours", label: "Opening hours", blurb: "Live from your business hours, special days included." },
  { key: "branches", label: "Find us / branches", blurb: "Address, directions, call and WhatsApp links." },
  { key: "reviews", label: "Google reviews link", blurb: "Shows only when a review link is set." },
  { key: "about", label: "About us", blurb: "Shows only when the blurb below has text." },
];

export function SiteSection({
  initial,
  siteUrl,
  canManage,
}: {
  initial: { published: boolean; sections: Record<string, boolean>; strapline: string; about: string };
  siteUrl: string;
  canManage: boolean;
}) {
  const [published, setPublished] = useState(initial.published);
  const [sections, setSections] = useState(initial.sections);
  const [strapline, setStrapline] = useState(initial.strapline);
  const [about, setAbout] = useState(initial.about);
  const [pending, startTransition] = useTransition();
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function save() {
    setInfo(null);
    setError(null);
    startTransition(async () => {
      const res = await saveSiteSettings({ published, sections, strapline, about });
      if ("error" in res) setError(res.error);
      else setInfo(published ? "Saved — your site is live." : "Saved — your site is unpublished.");
    });
  }

  return (
    <section className="rounded-lg border p-4 flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Your garage website</h2>
          <p className="mt-0.5 max-w-xl text-xs text-muted-foreground">
            A fast, mobile-first page at your booking address, built from what&apos;s already in AI Garage —
            services, prices, opening hours, branches. Publish when you&apos;re happy; unpublishing brings the
            simple welcome page back.
          </p>
        </div>
        <a
          href={siteUrl}
          target="_blank"
          rel="noopener"
          className="inline-flex items-center gap-1.5 text-sm underline underline-offset-4 text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="h-3.5 w-3.5" /> View {published ? "your site" : "current page"}
        </a>
      </div>

      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={published}
          onChange={(e) => setPublished(e.target.checked)}
          disabled={!canManage || pending}
          className="h-4 w-4 accent-current"
        />
        Publish the website
      </label>

      <div className="grid gap-2 sm:grid-cols-2">
        {SECTIONS.map((s) => (
          <label key={s.key} className="flex items-start gap-2 rounded-md border p-2.5 text-sm">
            <input
              type="checkbox"
              checked={sections[s.key] !== false}
              onChange={(e) => setSections({ ...sections, [s.key]: e.target.checked })}
              disabled={!canManage || pending}
              className="mt-0.5 h-4 w-4 accent-current"
            />
            <span>
              <span className="font-medium">{s.label}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{s.blurb}</span>
            </span>
          </label>
        ))}
      </div>

      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Strapline (under your garage name)
        <input
          type="text"
          value={strapline}
          onChange={(e) => setStrapline(e.target.value)}
          maxLength={160}
          disabled={!canManage || pending}
          placeholder="MOTs, servicing and repairs — book online in under a minute."
          className="rounded-md border bg-transparent px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        About us
        <textarea
          value={about}
          onChange={(e) => setAbout(e.target.value)}
          rows={4}
          maxLength={2000}
          disabled={!canManage || pending}
          placeholder="Family-run since 1998. DVSA-approved MOT centre…"
          className="rounded-md border bg-transparent px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground"
        />
      </label>

      {canManage ? (
        <div className="flex items-center gap-3">
          <Button size="sm" onClick={save} loading={pending}>
            Save
          </Button>
          {info && <p className="text-sm text-ws-green">{info}</p>}
          {error && <p className="text-sm text-ws-red">{error}</p>}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Only owners and admins can change the website.</p>
      )}
    </section>
  );
}
