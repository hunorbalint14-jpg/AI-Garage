"use client";

import { useRef, useState, useTransition } from "react";
import { replyToTicketAction } from "../actions";

export function ReplyForm({ ticketId, showReopenHint }: { ticketId: string; showReopenHint: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await replyToTicketAction(ticketId, formData);
      if ("error" in result) setError(result.error);
      else formRef.current?.reset();
    });
  }

  return (
    <form ref={formRef} action={handleSubmit} className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <label htmlFor="body" className="text-sm font-medium">
        Reply
      </label>
      <textarea
        id="body"
        name="body"
        required
        rows={4}
        maxLength={10000}
        className="rounded-md border bg-background px-3 py-2 text-sm"
      />
      {showReopenHint && (
        <p className="text-xs text-muted-foreground">Replying reopens this resolved ticket.</p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {pending ? "Sending…" : "Send reply"}
        </button>
      </div>
    </form>
  );
}
