"use client";

import { ErrorScreen } from "@/components/error-screen";

// Staff-portal boundary: renders inside the persistent shell, so the sidebar
// and branch switcher survive a page crash and staff can navigate away.
export default function StaffError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <ErrorScreen
      error={error}
      retry={unstable_retry}
      title="This page hit an error"
      message="The rest of the portal is unaffected — your work elsewhere is safe. Trying again usually fixes it; if it keeps happening, quote the reference below to support."
      links={[{ href: "/staff", label: "Back to dashboard" }]}
    />
  );
}
