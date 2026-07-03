"use client";

import { ErrorScreen } from "@/components/error-screen";

// Token-gated public quote page — a crash here strands a customer with no nav
// at all, so reassure them the link itself still works.
export default function QuoteError({
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
      title="Couldn't load this quote"
      message="An unexpected error stopped the quote from loading. Your link is still valid — try again in a moment, or reopen it from the message your garage sent you."
    />
  );
}
