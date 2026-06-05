"use client";

import { useState } from "react";
import { AigSpinner } from "@/components/ui/aig-spinner";
import { signInCustomer, sendCustomerMagicLink } from "./actions";

type Mode = "magic-link" | "password";

export function CustomerLoginForm({
  garageName,
  primaryColor = "#6366f1",
}: {
  garageName: string;
  primaryColor?: string;
}) {
  const [mode, setMode] = useState<Mode>("magic-link");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setMessage(null);

    if (mode === "magic-link") {
      const result = await sendCustomerMagicLink(email);
      if ("error" in result) setError(result.error);
      else setMessage("Check your email for the sign-in link.");
    } else {
      const result = await signInCustomer(email, password);
      if ("error" in result) setError(result.error);
      else window.location.href = "/dashboard";
    }
    setPending(false);
  }

  return (
    <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/[0.03] p-8 backdrop-blur-md shadow-2xl">
      <h1 className="text-2xl font-bold tracking-tight">Sign in to {garageName}</h1>
      <p className="mt-1.5 text-sm text-gray-400">Use a one-time email link or your password.</p>

      <div className="mt-6 flex rounded-lg border border-white/10 p-0.5 text-sm">
        {(["magic-link", "password"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className="flex-1 rounded-md py-1.5 text-center transition-all"
            style={
              mode === m
                ? { backgroundColor: primaryColor, color: "#fff" }
                : { color: "#9ca3af" }
            }
          >
            {m === "magic-link" ? "Email link" : "Password"}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-4">
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

        {mode === "password" && (
          <>
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
          </>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}
        {message && <p className="text-sm text-green-400">{message}</p>}

        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60 shadow-lg"
          style={{ backgroundColor: primaryColor, boxShadow: `0 8px 16px -8px ${primaryColor}60` }}
        >
          {pending && <AigSpinner />}
          {mode === "magic-link" ? "Email me a link" : "Sign in"}
        </button>

        <p className="text-center text-xs text-gray-400">
          New customer?{" "}
          <a href="/register" className="underline hover:text-white" style={{ color: primaryColor }}>
            Create an account
          </a>
        </p>
      </form>
    </div>
  );
}
