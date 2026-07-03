"use client";

import { ErrorScreen } from "@/components/error-screen";

// Customer portal boundary — the portal has no persistent shell, so brand the
// full screen and offer a way back in.
export default function DashboardError({
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
      title="Couldn't load your dashboard"
      message="An unexpected error stopped the page from loading. Nothing on your account has changed — try again in a moment."
      links={[{ href: "/dashboard", label: "Reload dashboard" }]}
    />
  );
}
