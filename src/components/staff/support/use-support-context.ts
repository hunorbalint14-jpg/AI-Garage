"use client";

import { usePathname } from "next/navigation";
import { SUPPORT_SHOT_MAX_BYTES } from "@/lib/support-shots-shared";

// Client-side context capture for the support widget: current path, the
// Sentry event id (if the DSN-gated SDK has recorded one) and an optional
// full-page screenshot.

export function useSupportPath(): string {
  return usePathname() || "/staff";
}

export async function sentryEventId(): Promise<string | null> {
  try {
    const Sentry = await import("@sentry/nextjs");
    return Sentry.lastEventId() || null;
  } catch {
    return null;
  }
}

// Full-page PNG via html-to-image, dynamically imported so the dependency
// never enters the shared bundle (loaded only when the escalate form opens).
// The [data-support-widget] filter keeps the widget itself (panel, launcher,
// toast, bell cluster) out of the capture. Returns null on any failure or
// when the result exceeds the upload cap — the ticket sends without it.
export async function captureScreenshot(): Promise<Blob | null> {
  try {
    const { toPng } = await import("html-to-image");
    const dataUrl = await toPng(document.body, {
      pixelRatio: 1,
      filter: (node) => {
        if (node instanceof HTMLElement && node.dataset.supportWidget !== undefined) return false;
        return true;
      },
    });
    // Decode the data: URL by hand — fetch(dataUrl) counts as a connect-src
    // request and our CSP (rightly) doesn't allow data: there.
    const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: "image/png" });
    if (blob.size === 0 || blob.size > SUPPORT_SHOT_MAX_BYTES) {
      console.warn("[support-widget] screenshot skipped: size", blob.size);
      return null;
    }
    return blob;
  } catch (err) {
    console.warn("[support-widget] screenshot capture failed", err);
    return null;
  }
}
