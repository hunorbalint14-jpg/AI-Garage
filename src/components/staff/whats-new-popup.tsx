"use client";

import { useEffect, useState } from "react";
import { X, Sparkles } from "lucide-react";
import { TrackedLink as Link } from "@/components/nav-progress";
import { latestRelease, type ReleaseEntryKind } from "@/lib/release-notes";

// One-shot "What's new" popup: shows when the latest release version hasn't
// been dismissed on this browser, and never again until the version changes.
// localStorage (not per-user server state) mirrors the support widget's peek
// toast — per-device is fine for an announcement.

const SEEN_KEY = "whats-new-seen";

const KIND_STYLE: Record<ReleaseEntryKind, string> = {
  new: "border-[#2d5a3f] bg-[#13301f] text-[#5fdd9d]",
  improved: "border-[#1e3a5f] bg-[#132030] text-[#7cb8f5]",
  fixed: "border-[#5a4218] bg-[#3a2c14] text-[#ffb020]",
};

export function WhatsNewPopup() {
  const [open, setOpen] = useState(false);
  const release = latestRelease();

  useEffect(() => {
    if (!release) return;
    let seen: string | null = null;
    try {
      seen = localStorage.getItem(SEEN_KEY);
    } catch {
      return; // storage unavailable — never nag
    }
    if (seen === release.version) return;
    // Small delay so the popup never competes with the page paint.
    const t = setTimeout(() => setOpen(true), 1200);
    return () => clearTimeout(t);
  }, [release]);

  function dismiss() {
    try {
      localStorage.setItem(SEEN_KEY, release.version);
    } catch {
      /* still close */
    }
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") dismiss();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open || !release) return null;

  return (
    <div className="fixed inset-0 z-[55] grid place-items-center p-4" role="dialog" aria-label="What's new">
      <button aria-label="Dismiss" onClick={dismiss} className="absolute inset-0 cursor-default bg-black/55" />
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-[#2a2f37] bg-[#111418] shadow-[0_24px_64px_rgba(0,0,0,.65)] animate-in fade-in zoom-in-95 duration-200 motion-reduce:animate-none">
        <div className="flex items-center gap-2.5 border-b border-[#22262e] px-5 py-4">
          <span className="grid h-8 w-8 flex-none place-items-center rounded-lg border border-[#2d5a3f] bg-[#13301f] text-[#5fdd9d]">
            <Sparkles className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold text-[#e6e8eb]">What&apos;s new in AI Garage</div>
            <div className="font-mono text-[10px] tracking-[.08em] text-[#5a6170]">
              {release.version.toUpperCase()} ·{" "}
              {new Date(release.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }).toUpperCase()}
            </div>
          </div>
          <button
            onClick={dismiss}
            aria-label="Close"
            className="grid h-7 w-7 place-items-center rounded-md text-[#5a6170] hover:bg-[#1c2026] hover:text-[#e6e8eb]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[55vh] overflow-y-auto overscroll-contain px-5 py-4">
          {release.summary && <p className="mb-3 text-[13px] leading-relaxed text-[#9aa1ad]">{release.summary}</p>}
          <ul className="flex flex-col gap-2.5">
            {release.entries.map((entry, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <span
                  className={`mt-0.5 w-[66px] flex-none rounded-full border px-1.5 py-px text-center font-mono text-[8.5px] uppercase tracking-[.08em] ${KIND_STYLE[entry.kind]}`}
                >
                  {entry.kind}
                </span>
                <span className="text-[13px] leading-snug text-[#d6dae0]">{entry.title}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[#22262e] bg-[#0e1116] px-5 py-3.5">
          <Link
            href="/staff/whats-new"
            onClick={dismiss}
            className="text-[12.5px] text-[#9aa1ad] underline-offset-2 hover:text-[#e6e8eb] hover:underline"
          >
            See all updates
          </Link>
          <button
            onClick={dismiss}
            className="rounded-lg bg-[#e6e8eb] px-4 py-2 text-[12.5px] font-semibold text-[#0e1014] hover:bg-white"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
