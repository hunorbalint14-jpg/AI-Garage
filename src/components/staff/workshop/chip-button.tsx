import Link from "next/link";
import type { ReactNode } from "react";

export type ChipVariant = "primary" | "secondary" | "quiet";

// Three-level button hierarchy (UX review §1b) — replaces the four competing
// button styles across the staff portal:
//   primary   — amber mono CTA, max ONE per screen (e.g. "+ NEW BOOKING")
//   secondary — bordered sans chip (e.g. "Export CSV")
//   quiet     — mono underlined link (e.g. "view history →")
const VARIANTS: Record<ChipVariant, string> = {
  primary:
    "rounded-[3px] border border-ws-amber-border bg-ws-amber-bg px-3.5 py-2 font-mono text-xs font-semibold uppercase tracking-[0.04em] text-ws-amber transition-colors hover:bg-[#453519]",
  secondary:
    "rounded-[3px] border border-ws-border bg-ws-hover px-3.5 py-[7px] font-sans text-xs font-medium text-ws-text transition-colors hover:bg-[#232830]",
  quiet:
    "border-b border-[#3a4049] pb-px font-mono text-[11px] font-medium text-ws-text-2 transition-colors hover:text-ws-text",
};

type CommonProps = {
  variant?: ChipVariant;
  className?: string;
  children: ReactNode;
};

type AsLink = CommonProps & { href: string; onClick?: never; type?: never; disabled?: never };
type AsButton = CommonProps & {
  href?: never;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
};

export function ChipButton(props: AsLink | AsButton) {
  const { variant = "secondary", className, children } = props;
  const cls = `inline-flex items-center gap-1.5 whitespace-nowrap no-underline ${VARIANTS[variant]}${className ? ` ${className}` : ""}`;

  if (props.href !== undefined) {
    return (
      <Link href={props.href} className={cls}>
        {children}
      </Link>
    );
  }
  return (
    <button
      type={props.type ?? "button"}
      onClick={props.onClick}
      disabled={props.disabled}
      className={`${cls} disabled:cursor-not-allowed disabled:opacity-50`}
    >
      {children}
    </button>
  );
}
