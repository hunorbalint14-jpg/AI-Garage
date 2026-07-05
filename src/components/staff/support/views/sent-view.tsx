"use client";

import { Check } from "lucide-react";

export function SentView({
  sentRef,
  userEmail,
  brandColor,
  onBrand,
  onViewTickets,
  onDone,
}: {
  sentRef: string | null;
  userEmail: string | null;
  brandColor: string;
  onBrand: string;
  onViewTickets: () => void;
  onDone: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-2.5 px-6 py-[30px] text-center">
      <span className="grid h-[38px] w-[38px] place-items-center rounded-full border border-[#2d5a3f] bg-[#13301f] text-[#5fdd9d]">
        <Check className="h-[17px] w-[17px]" />
      </span>
      <div className="text-[15px] font-semibold text-[#e6e8eb]">Ticket sent</div>
      {sentRef && (
        <span className="rounded-[5px] border border-[#2a2f37] bg-[#0e1116] px-[9px] py-1 font-mono text-[11px] tracking-[.08em] text-[#9aa1ad]">
          {sentRef}
        </span>
      )}
      <p className="m-0 text-[12px] leading-[1.55] text-[#9aa1ad]">
        The AI Garage team replies here{userEmail ? ` and at ${userEmail}` : ""} — typically the
        same working day.
      </p>
      <div className="mt-1 flex gap-2">
        <button
          onClick={onViewTickets}
          className="rounded-lg border border-[#2a2f37] px-3.5 py-2 text-[12.5px] text-[#9aa1ad] hover:bg-[#1c2026] hover:text-[#e6e8eb]"
        >
          View my tickets
        </button>
        <button
          onClick={onDone}
          className="rounded-lg px-4 py-2 text-[12.5px] font-semibold"
          style={{ background: brandColor, color: onBrand }}
        >
          Done
        </button>
      </div>
    </div>
  );
}
