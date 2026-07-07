// UK number-plate chip (UX review §1b). Style lifted verbatim from the
// dashboard's inline plate markup (attention-queue / my-day) — those now
// import this instead.
export function Plate({ reg, className }: { reg: string; className?: string }) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-[3px] border border-ws-plate-border bg-ws-plate px-[7px] py-0.5 font-mono text-[11px] font-bold tracking-[0.06em] text-background${className ? ` ${className}` : ""}`}
    >
      {reg}
    </span>
  );
}
