"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getStaffTenantUrl } from "./actions";

const ROOT_HOST =
  (process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localtest.me:3000").split(":")[0];

function isRootDomain() {
  if (typeof window === "undefined") return false;
  const h = window.location.hostname;
  return h === ROOT_HOST || h === `www.${ROOT_HOST}`;
}

export function StaffLoginForm({
  initialEmail = "",
  accentColor,
}: {
  initialEmail?: string;
  accentColor?: string;
}) {
  const supabase = createClient();
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const btnColor = accentColor ?? "#6366f1";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);

    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInErr) {
      setError(signInErr.message);
      setPending(false);
      return;
    }

    if (isRootDomain()) {
      const result = await getStaffTenantUrl();
      if ("error" in result) {
        setError(result.error);
        setPending(false);
        return;
      }
      window.location.href = result.url;
    } else {
      window.location.href = "/staff";
    }
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
          className="rounded-lg py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60 shadow-lg"
          style={{ backgroundColor: btnColor, boxShadow: `0 8px 16px -8px ${btnColor}60` }}
        >
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
