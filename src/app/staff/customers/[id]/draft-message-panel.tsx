"use client";

import { useState, useTransition } from "react";
import { sendCustomMessage } from "../actions";
import { Button } from "@/components/ui/button";

type Props = {
  customerId: string;
  hasEmail: boolean;
  hasPhone: boolean;
};

export function DraftMessagePanel({ customerId, hasEmail, hasPhone }: Props) {
  const [topic, setTopic] = useState("");
  const [channels, setChannels] = useState<Set<"email" | "sms">>(new Set());
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  function toggle(ch: "email" | "sms") {
    setChannels((prev) => {
      const next = new Set(prev);
      next.has(ch) ? next.delete(ch) : next.add(ch);
      return next;
    });
  }

  function handleSend() {
    if (!topic.trim() || channels.size === 0) return;
    setStatus("idle");
    setMessage(null);
    startTransition(async () => {
      const result = await sendCustomMessage(customerId, topic.trim(), [...channels]);
      if ("error" in result) {
        setStatus("error");
        setMessage(result.error);
      } else {
        setStatus("success");
        setMessage(result.summary);
        setTopic("");
        setChannels(new Set());
      }
    });
  }

  const canSend = topic.trim().length > 0 && channels.size > 0 && !pending;

  return (
    <section className="rounded-lg border p-4 flex flex-col gap-3">
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
        AI Message
      </h2>
      <textarea
        className="min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm resize-none placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
        placeholder="What do you want to communicate? e.g. 'Follow up on the brake job quote from last week'"
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
        disabled={pending}
      />
      <div className="flex items-center gap-4 text-sm">
        {hasEmail && (
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              className="rounded"
              checked={channels.has("email")}
              onChange={() => toggle("email")}
              disabled={pending}
            />
            Email
          </label>
        )}
        {hasPhone && (
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              className="rounded"
              checked={channels.has("sms")}
              onChange={() => toggle("sms")}
              disabled={pending}
            />
            SMS
          </label>
        )}
        {!hasEmail && !hasPhone && (
          <span className="text-muted-foreground text-xs">
            No email or phone on file — add contact details to send messages.
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <Button
          type="button"
          size="sm"
          disabled={!canSend}
          onClick={handleSend}
        >
          {pending ? "Drafting & sending…" : "Draft & send with AI"}
        </Button>
        {status === "success" && (
          <span className="text-sm text-green-700">{message}</span>
        )}
        {status === "error" && (
          <span className="text-sm text-red-600">{message}</span>
        )}
      </div>
    </section>
  );
}
