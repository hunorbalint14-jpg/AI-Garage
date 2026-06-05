"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { AigSpinner } from "@/components/ui/aig-spinner";
import { signUpGarage } from "./actions";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth-constants";

const ROOT_HOSTNAME = (process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localtest.me:3000").split(":")[0];

const inputCls =
  "w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:border-white/30 focus:outline-none";

export function SignupForm() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [slug, setSlug] = useState("");

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await signUpGarage(formData);
      if ("error" in result) {
        setError(result.error);
      } else {
        window.location.href = result.redirectUrl;
      }
    });
  }

  return (
    <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.03] p-8 backdrop-blur-md shadow-2xl">
      <h1 className="text-2xl font-bold tracking-tight">Get started free</h1>
      <p className="mt-1.5 text-sm text-gray-400">
        Create your garage&apos;s account. You&apos;ll get your own branded subdomain.
      </p>

      <form action={handleSubmit} className="mt-6 flex flex-col gap-4">
        <div>
          <label htmlFor="businessName" className="mb-1.5 block text-xs font-medium text-gray-300">
            Business name
          </label>
          <input id="businessName" name="businessName" required className={inputCls} />
        </div>

        <div>
          <label htmlFor="slug" className="mb-1.5 block text-xs font-medium text-gray-300">
            Subdomain
          </label>
          <input
            id="slug"
            name="slug"
            required
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
            placeholder="smith-motors"
            autoComplete="off"
            className={inputCls}
          />
          <p className="mt-1 text-xs text-gray-500">
            {slug || "your-garage"}.{ROOT_HOSTNAME}
          </p>
        </div>

        <div>
          <label htmlFor="ownerName" className="mb-1.5 block text-xs font-medium text-gray-300">
            Your name
          </label>
          <input id="ownerName" name="ownerName" required autoComplete="name" className={inputCls} />
        </div>

        <div>
          <label htmlFor="email" className="mb-1.5 block text-xs font-medium text-gray-300">
            Email
          </label>
          <input id="email" name="email" type="email" required autoComplete="email" className={inputCls} />
        </div>

        <div>
          <label htmlFor="password" className="mb-1.5 block text-xs font-medium text-gray-300">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete="new-password"
            className={inputCls}
          />
          <p className="mt-1 text-xs text-gray-500">At least {MIN_PASSWORD_LENGTH} characters.</p>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:opacity-60 shadow-lg shadow-indigo-900/50"
        >
          {pending && <AigSpinner />}
          {pending ? "Creating your garage…" : "Create garage"}
        </button>

        <p className="text-center text-xs text-gray-400">
          Already have an account?{" "}
          <Link href="/staff/login" className="text-indigo-400 underline hover:text-indigo-300">
            Staff sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
