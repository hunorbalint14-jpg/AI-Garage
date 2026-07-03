"use client";

import { ErrorScreen } from "@/components/error-screen";

// Token-gated public invoice page — no nav to fall back on, so keep the
// customer oriented and the link trustworthy.
export default function InvoiceError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <ErrorScreen
      standalone
      error={error}
      retry={unstable_retry}
      title="Couldn't load this invoice"
      message="An unexpected error stopped the invoice from loading. Your link is still valid — try again in a moment, or reopen it from the message your garage sent you."
    />
  );
}
