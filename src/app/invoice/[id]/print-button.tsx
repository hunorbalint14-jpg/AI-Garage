"use client";

// Client component so the print action can use an onClick handler — a Server
// Component can't pass event handlers across the RSC boundary. Replaces the
// old no-op <button onClick> + inline <script> querySelector hack.
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-gray-300 hover:bg-white/10 transition-colors"
    >
      Print / Save PDF
    </button>
  );
}
