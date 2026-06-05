import { cn } from "@/lib/utils";

// Brand inline spinner (AIGarage FrameG mark). Sizes to font-size and inherits
// the surrounding text colour via currentColor — drop it into any button/chip.
// Pass `label` for a standalone spinner; omit it (default aria-hidden) when
// adjacent text already conveys the loading state (e.g. "Saving…").
export function AigSpinner({ className, label }: { className?: string; label?: string }) {
  return (
    <svg
      className={cn("aig-spin-inline", className)}
      viewBox="0 0 100 100"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path
        d="M 86 32 L 86 14 L 14 14 L 14 86 L 86 86 L 86 68"
        pathLength={100}
        fill="none"
        stroke="currentColor"
        strokeWidth={14}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
