"use client";

import { useState, useTransition } from "react";
import { updatePassword } from "./actions";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth-constants";

export function ResetPasswordForm({ token }: { token: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function handleSubmit(formData: FormData) {
    setError(null);
    formData.set("token", token);
    startTransition(async () => {
      const result = await updatePassword(formData);
      if ("error" in result) {
        setError(result.error);
      } else {
        setDone(true);
        setTimeout(() => { window.location.href = "/"; }, 2000);
      }
    });
  }

  if (done) {
    return (
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/[0.03] p-8 backdrop-blur-md text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-500/20 text-green-400">
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-xl font-bold">Password updated</h2>
        <p className="mt-2 text-sm text-gray-400">Redirecting you now…</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/[0.03] p-8 backdrop-blur-md shadow-2xl">
      <h1 className="text-2xl font-bold tracking-tight">Choose a new password</h1>
      <p className="mt-1.5 text-sm text-gray-400">Must be at least {MIN_PASSWORD_LENGTH} characters.</p>

      <form action={handleSubmit} className="mt-6 flex flex-col gap-4">
        <div>
          <label htmlFor="password" className="mb-1.5 block text-xs font-medium text-gray-300">
            New password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete="new-password"
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="confirm" className="mb-1.5 block text-xs font-medium text-gray-300">
            Confirm password
          </label>
          <input
            id="confirm"
            name="confirm"
            type="password"
            required
            autoComplete="new-password"
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
          />
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:opacity-60"
        >
          {pending ? "Updating…" : "Update password"}
        </button>
      </form>
    </div>
  );
}
