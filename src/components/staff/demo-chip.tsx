// Amber "demo" badge for sandbox rows (#506 PR 3). Render next to the row's
// primary label on any surface that lists is_demo rows.
export function DemoChip() {
  return (
    <span className="inline-flex items-center rounded border border-amber-500/40 bg-amber-500/10 px-1 py-px font-mono text-[9px] uppercase tracking-[0.1em] text-amber-400 align-middle">
      demo
    </span>
  );
}
