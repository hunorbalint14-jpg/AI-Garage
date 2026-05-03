"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { registerCustomer } from "./actions";
import { createClient } from "@/lib/supabase/client";

export function RegisterForm({
  garageName,
  primaryColor = "#6366f1",
}: {
  garageName: string;
  primaryColor?: string;
}) {
  const supabase = createClient();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await registerCustomer(formData);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signInErr) {
        setError("Account created but could not sign in automatically. Please sign in manually.");
        return;
      }
      window.location.href = "/dashboard";
    });
  }

  return (
    <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/[0.03] p-8 backdrop-blur-md shadow-2xl">
      <h1 className="text-2xl font-bold tracking-tight">Create your account</h1>
      <p className="mt-1.5 text-sm text-gray-400">
        Register with {garageName} to view your vehicles and MOT history.
      </p>

      <form action={handleSubmit} className="mt-6 flex flex-col gap-4">
        <Field id="fullName" label="Full name" name="fullName" autoComplete="name" required />
        <Field
          id="email"
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Field id="phone" label="Phone (optional)" name="phone" type="tel" autoComplete="tel" placeholder="07123 456789" />
        <div>
          <Field
            id="password"
            label="Password"
            name="password"
            type="password"
            required
            minLength={6}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <p className="mt-1 text-xs text-gray-500">At least 6 characters.</p>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={pending}
          className="rounded-lg py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60 shadow-lg"
          style={{ backgroundColor: primaryColor, boxShadow: `0 8px 16px -8px ${primaryColor}60` }}
        >
          {pending ? "Creating account…" : "Create account"}
        </button>

        <p className="text-center text-xs text-gray-400">
          Already have an account?{" "}
          <Link href="/login" className="underline hover:text-white" style={{ color: primaryColor }}>
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}

function Field({
  id,
  label,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { id: string; label: string }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-gray-300">
        {label}
      </label>
      <input
        id={id}
        {...props}
        className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:border-white/30 focus:outline-none"
      />
    </div>
  );
}
