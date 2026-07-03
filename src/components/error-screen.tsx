"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { AlertTriangle } from "lucide-react";

// Shared UI for route error boundaries (error.tsx files). Two variants:
// `standalone` fills the viewport for routes with no persistent shell (customer
// pages, root); without it the card sits in the parent layout's content area
// (staff portal — the sidebar and top bar survive the crash).
export function ErrorScreen({
  error,
  retry,
  title = "Something went wrong",
  message = "An unexpected error stopped this page from loading. It's usually temporary — trying again often fixes it.",
  links = [],
  standalone = false,
}: {
  error: Error & { digest?: string };
  retry: () => void;
  title?: string;
  message?: string;
  links?: { href: string; label: string }[];
  standalone?: boolean;
}) {
  useEffect(() => {
    // Server-component errors (they carry a digest) are already reported by
    // Sentry's onRequestError on the server — only capture client-side throws
    // here, otherwise every server error is double-counted.
    if (!error.digest) Sentry.captureException(error);
  }, [error]);

  const card = (
    <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-10 text-center backdrop-blur-sm">
      <AlertTriangle className="mx-auto h-10 w-10 text-amber-400" aria-hidden />
      <h1 className="mt-4 text-2xl font-bold text-white">{title}</h1>
      <p className="mt-3 text-sm text-gray-400">{message}</p>
      <button
        type="button"
        onClick={retry}
        className="mt-6 inline-block rounded-lg bg-green-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-green-500"
      >
        Try again
      </button>
      {links.length > 0 && (
        <div className="mt-4 flex justify-center gap-4 text-sm">
          {links.map((l) => (
            // Plain <a>, not <Link>: after a crash a full navigation is the
            // reliable escape hatch (client-side nav can re-enter the error).
            <a key={l.href} href={l.href} className="text-gray-400 underline hover:text-white">
              {l.label}
            </a>
          ))}
        </div>
      )}
      {error.digest && (
        <p className="mt-6 text-xs text-gray-500">
          Error reference: <code className="font-mono">{error.digest}</code>
        </p>
      )}
    </div>
  );

  if (!standalone) {
    return <div className="flex min-h-[50vh] items-center justify-center">{card}</div>;
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0b0d11] px-6 text-white">
      {card}
    </div>
  );
}
