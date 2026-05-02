"use client";

import { useState, useTransition } from "react";
import { sendReminder } from "../actions";
import { Button } from "@/components/ui/button";

type Props = {
  vehicleId: string;
  reminderType: "mot" | "service";
  disabled?: boolean;
};

export function ReminderButton({ vehicleId, reminderType, disabled }: Props) {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  function handleClick() {
    setStatus("idle");
    setMessage(null);
    startTransition(async () => {
      const result = await sendReminder(vehicleId, reminderType);
      if ("error" in result) {
        setStatus("error");
        setMessage(result.error);
      } else {
        setStatus("success");
        setMessage("Reminder sent.");
      }
    });
  }

  const label = reminderType === "mot" ? "MOT" : "service";

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        type="button"
        size="xs"
        variant="outline"
        disabled={disabled || pending}
        onClick={handleClick}
      >
        {pending ? "Sending…" : `Send ${label} reminder`}
      </Button>
      {status === "success" && (
        <span className="text-xs text-green-700">{message}</span>
      )}
      {status === "error" && (
        <span className="text-xs text-red-600">{message}</span>
      )}
    </div>
  );
}
