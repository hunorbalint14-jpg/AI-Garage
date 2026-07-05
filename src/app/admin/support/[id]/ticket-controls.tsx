"use client";

import { useRef, useState, useTransition } from "react";
import { useConfirm } from "@/components/confirm-provider";
import {
  statusesForType,
  isTerminalForStaff,
  STATUS_LABELS,
  PRIORITY_LABELS,
  TICKET_PRIORITIES,
  type TicketStatus,
  type TicketType,
  type TicketPriority,
} from "@/lib/support-tickets-shared";
import { adminReplyAction, adminSetStatusAction, adminSetPriorityAction } from "../actions";

export function TicketControls({
  ticketId,
  ticketType,
  currentStatus,
  currentPriority,
}: {
  ticketId: string;
  ticketType: TicketType;
  currentStatus: TicketStatus;
  currentPriority: TicketPriority;
}) {
  const [error, setError] = useState<string | null>(null);
  const [internal, setInternal] = useState(false);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const confirm = useConfirm();

  const statuses = statusesForType(ticketType);

  function submitReply(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await adminReplyAction(ticketId, formData);
      if ("error" in result) setError(result.error);
      else {
        formRef.current?.reset();
        setInternal(false);
      }
    });
  }

  async function changeStatus(to: string) {
    if (to === currentStatus || !to) return;
    if (isTerminalForStaff(to as TicketStatus)) {
      const ok = await confirm({
        title: `Mark as ${STATUS_LABELS[to as TicketStatus]}?`,
        description:
          "The garage will no longer be able to reply to this ticket. You can reopen it later from the status control.",
        confirmLabel: STATUS_LABELS[to as TicketStatus],
      });
      if (!ok) return;
    }
    setError(null);
    startTransition(async () => {
      const result = await adminSetStatusAction(ticketId, to);
      if ("error" in result) setError(result.error);
    });
  }

  function changePriority(to: string) {
    if (to === currentPriority) return;
    setError(null);
    startTransition(async () => {
      const result = await adminSetPriorityAction(ticketId, to);
      if ("error" in result) setError(result.error);
    });
  }

  const selectClass =
    "rounded-md border border-[#2a2f37] bg-[#15181d] px-2 py-1.5 text-[12px] text-[#e6e8eb]";

  return (
    <div
      className={`flex flex-col gap-3 rounded-xl border p-4 ${
        internal ? "border-[#5a4218] bg-[#241c0d]" : "border-[#23272f] bg-[#171b21]"
      }`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[12px] text-[#9aa1ad]">
          Status
          <select
            className={selectClass}
            value={currentStatus}
            onChange={(e) => changeStatus(e.target.value)}
            disabled={pending}
          >
            {statuses.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-[12px] text-[#9aa1ad]">
          Priority
          <select
            className={selectClass}
            value={currentPriority}
            onChange={(e) => changePriority(e.target.value)}
            disabled={pending}
          >
            {TICKET_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <form ref={formRef} action={submitReply} className="flex flex-col gap-2.5">
        <textarea
          name="body"
          required
          rows={4}
          maxLength={10000}
          placeholder={internal ? "Internal note — never visible to the garage…" : "Reply to the garage…"}
          className="rounded-md border border-[#2a2f37] bg-[#15181d] px-3 py-2 text-[13px] text-[#e6e8eb] placeholder:text-[#5a6170]"
        />
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-[#9aa1ad]">
            <input
              type="checkbox"
              name="internal"
              checked={internal}
              onChange={(e) => setInternal(e.target.checked)}
            />
            Internal note
          </label>
          {!internal && (
            <label className="flex items-center gap-1.5 text-[12px] text-[#9aa1ad]">
              Set status on send
              <select name="status" defaultValue="" className={selectClass}>
                <option value="">— keep {STATUS_LABELS[currentStatus]}</option>
                {statuses
                  .filter((s) => s !== currentStatus)
                  .map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <button
            type="submit"
            disabled={pending}
            className={`ml-auto rounded-md px-3.5 py-1.5 text-[12.5px] font-semibold disabled:opacity-50 ${
              internal ? "bg-[#ffb020] text-black" : "bg-[#22c55e] text-black"
            }`}
          >
            {pending ? "Sending…" : internal ? "Add internal note" : "Send reply"}
          </button>
        </div>
        {error && <p className="text-[12px] text-[#ff7b7b]">{error}</p>}
      </form>
    </div>
  );
}
