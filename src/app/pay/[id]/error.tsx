"use client";

import { ErrorScreen } from "@/components/error-screen";

// Payment page boundary. A customer mid-payment must know whether they were
// charged: card capture happens on Stripe's side, so an error rendering this
// page means no charge was taken by it — say so explicitly.
export default function PayError({
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
      title="Couldn't load the payment page"
      message="An unexpected error stopped this page from loading — no payment was taken. Try again in a moment. If you'd already completed payment, you'll have a receipt by email and don't need to pay again."
    />
  );
}
