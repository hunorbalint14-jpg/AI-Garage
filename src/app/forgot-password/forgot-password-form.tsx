"use client";

import { useState, useTransition } from "react";
import { AigSpinner } from "@/components/ui/aig-spinner";
import { requestPasswordReset } from "./actions";

export function ForgotPasswordForm() {
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await requestPasswordReset(email);
      if ("error" in result) setError(result.error);
      else setSent(true);
    });
  }

  if (sent) {
    return (
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/[0.03] p-8 backdrop-blur-md text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-500/20 text-green-400">
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-xl font-bold">Check your email</h2>
        <p className="mt-2 text-sm text-gray-400">
          We sent a reset link to <span className="text-white font-medium">{email}</span>.
        </p>
        <p className="mt-4 text-xs text-gray-500">
          Didn&apos;t receive it?{" "}
          <button className="underline hover:text-white" onClick={() => setSent(false)}>
            Try again
          </button>
        </p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/[0.03] p-8 backdrop-blur-md shadow-2xl">
      <h1 className="text-2xl font-bold tracking-tight">Reset your password</h1>
      <p className="mt-1.5 text-sm text-gray-400">
        Enter your email and we&apos;ll send you a reset link.
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
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:opacity-60"
        >
          {pending && <AigSpinner />}
          Send reset link
        </button>
        <p className="text-center text-xs text-gray-400">
          <a href="/login" className="underline hover:text-white">
            Back to sign in
          </a>
        </p>
      </form>
    </div>
  );
}
