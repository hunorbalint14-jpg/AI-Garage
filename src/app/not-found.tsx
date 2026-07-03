import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Page not found",
};

// Branded 404 — used for notFound() throws without a closer not-found.tsx and
// for any URL that matches no route at all. Plain <a> links: this can render
// for signed-out visitors, so both portal links go through their auth gates.
export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0b0d11] px-6 text-white">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-10 text-center backdrop-blur-sm">
        <p className="font-mono text-5xl font-bold text-green-500">404</p>
        <h1 className="mt-4 text-2xl font-bold">Page not found</h1>
        <p className="mt-3 text-sm text-gray-400">
          This page doesn&apos;t exist — the link may be out of date, or the item it pointed to has
          been removed.
        </p>
        <div className="mt-6 flex justify-center gap-4 text-sm">
          <a
            href="/dashboard"
            className="rounded-lg bg-green-600 px-5 py-2.5 font-semibold text-white transition-colors hover:bg-green-500"
          >
            Customer portal
          </a>
          <a
            href="/staff"
            className="rounded-lg border border-white/15 px-5 py-2.5 font-semibold text-white transition-colors hover:bg-white/10"
          >
            Staff portal
          </a>
        </div>
      </div>
    </div>
  );
}
