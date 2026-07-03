"use client";

import { ErrorScreen } from "@/components/error-screen";

// Root error boundary — catches any route without a closer error.tsx. Branded,
// recoverable, and shows the digest so support can find the server log.
export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return <ErrorScreen standalone error={error} retry={unstable_retry} />;
}
