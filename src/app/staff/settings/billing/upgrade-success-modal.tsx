"use client";

import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

// Shown after returning from Stripe (checkout or the billing portal). The page
// has already reconciled the live tier from Stripe before rendering, so
// `planName` is the up-to-date plan. Dismiss clears the ?upgraded flag.
export function UpgradeSuccessModal({ planName }: { planName: string }) {
  const router = useRouter();
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4"
    >
      <div className="w-full max-w-sm rounded-2xl border bg-card p-6 text-center shadow-xl">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-500/15">
          <CheckCircle2 className="h-6 w-6 text-green-600" />
        </div>
        <h2 className="text-lg font-semibold">You&apos;re on {planName}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Your plan has been updated successfully.
        </p>
        <Button className="mt-5 w-full" onClick={() => router.replace("/staff/settings/billing")}>
          Done
        </Button>
      </div>
    </div>
  );
}
