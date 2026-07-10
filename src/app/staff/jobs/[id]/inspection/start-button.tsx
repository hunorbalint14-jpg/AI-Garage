"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { startInspection } from "./actions";

export function StartInspectionButton({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <Button
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await startInspection(jobId);
            if ("error" in result) setError(result.error);
            else router.refresh();
          });
        }}
        loading={pending}
      >
        Start health check
      </Button>
      {error && <p className="text-sm text-ws-red">{error}</p>}
    </div>
  );
}
