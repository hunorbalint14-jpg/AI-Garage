"use client";

import { useState } from "react";
import { startAuthentication } from "@simplewebauthn/browser";
import { AigSpinner } from "@/components/ui/aig-spinner";
import { signInStaff } from "./actions";

export function StaffLoginForm({
  initialEmail = "",
  accentColor,
}: {
  initialEmail?: string;
  accentColor?: string;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const btnColor = accentColor ?? "#6366f1";

  async function handlePasskey() {
    setError(null);
    setPending(true);
    try {
      if (typeof window === "undefined" || !window.PublicKeyCredential) {
        setError("This browser doesn't support passkeys.");
        setPending(false);
        return;
      }
      const beginRes = await fetch("/api/auth/passkey/login/begin", { method: "POST" });
      if (!beginRes.ok) throw new Error(`Begin failed: ${beginRes.status}`);
      const options = await beginRes.json();

      const assertion = await startAuthentication({ optionsJSON: options });

      const completeRes = await fetch("/api/auth/passkey/login/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assertion }),
      });
      const result = await completeRes.json();
      if (!completeRes.ok) {
        setError(result.error ?? `Failed: ${completeRes.status}`);
        setPending(false);
        return;
      }
      window.location.href = result.redirect ?? "/staff";
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("NotAllowed") || msg.includes("cancel")) {
        setError("Passkey sign-in cancelled.");
      } else {
        setError(msg);
      }
      setPending(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);

    const result = await signInStaff(email, password);
    if ("error" in result) {
      setError(result.error);
      setPending(false);
      return;
    }
    window.location.href = result.url;
  }

  return (
    <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/[0.03] p-8 backdrop-blur-md shadow-2xl">
      <h1 className="text-2xl font-bold tracking-tight">Staff sign in</h1>
      <p className="mt-1.5 text-sm text-gray-400">
        For garage owners and staff. Customers should use the main sign-in page.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
        <div>
          <label htmlFor="email" className="mb-1.5 block text-xs font-medium text-gray-300">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:border-white/30 focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="password" className="mb-1.5 block text-xs font-medium text-gray-300">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
          />
        </div>

        <p className="text-right text-xs">
          <a href="/forgot-password" className="text-gray-400 hover:text-white underline">
            Forgot password?
          </a>
        </p>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60 shadow-lg"
          style={{ backgroundColor: btnColor, boxShadow: `0 8px 16px -8px ${btnColor}60` }}
        >
          {pending && <AigSpinner />}
          Sign in
        </button>

        <div className="flex items-center gap-2 my-1">
          <div className="flex-1 h-px bg-white/10" />
          <span className="text-xs text-gray-500">or</span>
          <div className="flex-1 h-px bg-white/10" />
        </div>

        <button
          type="button"
          onClick={handlePasskey}
          disabled={pending}
          className="rounded-lg border border-white/20 bg-white/5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/10 disabled:opacity-60"
        >
          Sign in with passkey
        </button>
      </form>
    </div>
  );
}
