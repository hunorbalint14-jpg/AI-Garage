"use client";

import { useRef, useState, useTransition } from "react";
import { ExternalLink, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { saveSiteSettings, draftSiteCopyAction, uploadGalleryPhoto, removeGalleryPhoto } from "./site-actions";
import type { MiniSiteSectionKey } from "@/lib/minisite-data";

// Mini-site settings (#507 PR 2): publish toggle, section toggles, copy
// fields. AI drafting arrives in PR 4 — the fields are plain textareas here.

const SECTIONS: { key: MiniSiteSectionKey; label: string; blurb: string }[] = [
  { key: "services", label: "Services & prices", blurb: "Active services with from-prices." },
  { key: "hours", label: "Opening hours", blurb: "Live from your business hours, special days included." },
  { key: "branches", label: "Find us / branches", blurb: "Address, directions, call and WhatsApp links." },
  { key: "reviews", label: "Google reviews link", blurb: "Shows only when a review link is set." },
  { key: "about", label: "About us", blurb: "Shows only when the blurb below has text." },
  { key: "gallery", label: "Photo gallery", blurb: "Up to 8 workshop photos." },
];

export function SiteSection({
  initial,
  siteUrl,
  canManage,
}: {
  initial: {
    published: boolean;
    sections: Record<string, boolean>;
    strapline: string;
    about: string;
    gallery: { path: string; url: string }[];
  };
  siteUrl: string;
  canManage: boolean;
}) {
  const [published, setPublished] = useState(initial.published);
  const [sections, setSections] = useState(initial.sections);
  const [strapline, setStrapline] = useState(initial.strapline);
  const [about, setAbout] = useState(initial.about);
  const [gallery, setGallery] = useState(initial.gallery);
  const [pending, startTransition] = useTransition();
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [galleryBusy, setGalleryBusy] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);

  async function handleDraft() {
    setError(null);
    setDrafting(true);
    const res = await draftSiteCopyAction();
    setDrafting(false);
    if ("error" in res) return setError(res.error);
    setStrapline(res.strapline);
    setAbout(res.about);
    setInfo("Drafted — edit anything, then Save.");
  }

  function publicUrlFor(path: string): string {
    // Mirrors storage getPublicUrl shape; only used for the fresh-upload echo.
    const existing = gallery.find((g) => g.path === path);
    return existing?.url ?? "";
  }

  async function handlePhoto() {
    const file = photoRef.current?.files?.[0];
    if (!file) return;
    setError(null);
    setGalleryBusy(true);
    const fd = new FormData();
    fd.set("photo", file);
    const res = await uploadGalleryPhoto(fd);
    setGalleryBusy(false);
    if (photoRef.current) photoRef.current.value = "";
    if ("error" in res) return setError(res.error);
    // Rebuild from paths; new paths without a known URL get one on reload —
    // show a lightweight placeholder meanwhile.
    setGallery(res.paths.map((p) => ({ path: p, url: publicUrlFor(p) })));
    setInfo("Photo added.");
  }

  async function handleRemovePhoto(path: string) {
    setError(null);
    setGalleryBusy(true);
    const res = await removeGalleryPhoto(path);
    setGalleryBusy(false);
    if ("error" in res) return setError(res.error);
    setGallery((g) => g.filter((p) => p.path !== path));
  }

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

      {canManage && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void handleDraft()} loading={drafting} disabled={pending}>
            <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Write it for me
          </Button>
          <span className="text-xs text-muted-foreground">
            Drafts the strapline and about text from your AI setup — you edit, nothing publishes itself.
          </span>
        </div>
      )}

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

      <div className="flex flex-col gap-2">
        <span className="text-xs text-muted-foreground">Photo gallery ({gallery.length}/8)</span>
        <div className="flex flex-wrap gap-2">
          {gallery.map((g) => (
            <div key={g.path} className="relative">
              {g.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={g.url} alt="" className="h-16 w-16 rounded-md border object-cover" />
              ) : (
                <div className="grid h-16 w-16 place-items-center rounded-md border text-[10px] text-muted-foreground">
                  saved
                </div>
              )}
              {canManage && (
                <button
                  type="button"
                  onClick={() => void handleRemovePhoto(g.path)}
                  disabled={galleryBusy}
                  aria-label="Remove photo"
                  className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full border bg-background text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
          {canManage && gallery.length < 8 && (
            <input
              ref={photoRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={() => void handlePhoto()}
              disabled={galleryBusy}
              className="text-xs file:mr-2 file:rounded-md file:border file:bg-transparent file:px-2 file:py-1 file:text-xs"
            />
          )}
        </div>
      </div>

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
