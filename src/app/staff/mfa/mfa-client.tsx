"use client";

import { useState, useTransition } from "react";
import { AigSpinner } from "@/components/ui/aig-spinner";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";

async function postJson(url: string, body?: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: "POST",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error((data.error as string) ?? "Something went wrong.");
  return data;
}

export function MfaClient({ hasPasskey, canSkip }: { hasPasskey: boolean; canSkip: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function enroll() {
    const options = await postJson("/api/auth/passkey/register/begin");
    const attestation = await startRegistration({
      optionsJSON: options as unknown as Parameters<typeof startRegistration>[0]["optionsJSON"],
    });
    await postJson("/api/auth/passkey/register/complete", { attestation, deviceName: null });
  }

  async function stepUp() {
    const options = await postJson("/api/auth/passkey/stepup/begin");
    const assertion = await startAuthentication({
      optionsJSON: options as unknown as Parameters<typeof startAuthentication>[0]["optionsJSON"],
    });
    await postJson("/api/auth/passkey/stepup/complete", { assertion });
  }

  function run() {
    setError(null);
    startTransition(async () => {
      try {
        if (!hasPasskey) await enroll();
        await stepUp();
        // Full reload so the layout re-runs with the freshly-set MFA cookie.
        window.location.href = "/staff";
      } catch (e) {
        setError((e as Error).message || "Something went wrong. Please try again.");
      }
    });
  }

  return (
    <div className="flex w-full flex-col gap-3">
      {error && <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500">{error}</p>}

      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-opacity disabled:opacity-50"
      >
        {pending && <AigSpinner />}
        {hasPasskey ? "Verify with passkey" : "Set up passkey"}
      </button>

      {canSkip && (
        <a href="/staff" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
          Skip for now
        </a>
      )}
    </div>
  );
}
