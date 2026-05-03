"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

type Mode = "magic-link" | "password";

export function CustomerLoginForm({
  garageName,
  primaryColor = "#4f46e5",
}: {
  garageName: string;
  primaryColor?: string;
}) {
  const supabase = createClient();
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
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=/dashboard`,
        },
      });
      if (error) setError(error.message);
      else setMessage("Check your email for the sign-in link.");
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
      else window.location.href = "/dashboard";
    }
    setPending(false);
  }

  return (
    <Card className="w-full max-w-sm shadow-md">
      <CardHeader>
        <CardTitle>Sign in to {garageName}</CardTitle>
        <CardDescription>Use a one-time email link or your password.</CardDescription>
      </CardHeader>
      <CardContent>
        {/* Mode toggle */}
        <div className="mb-5 flex rounded-lg border p-0.5 text-sm">
          {(["magic-link", "password"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className="flex-1 rounded-md py-1.5 text-center transition-all"
              style={
                mode === m
                  ? { backgroundColor: primaryColor, color: "#fff" }
                  : { color: "#6b7280" }
              }
            >
              {m === "magic-link" ? "Email link" : "Password"}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>

          {mode === "password" && (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </div>
              <p className="text-right text-xs">
                <a href="/forgot-password" className="underline text-muted-foreground">
                  Forgot password?
                </a>
              </p>
            </>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
          {message && <p className="text-sm text-green-700">{message}</p>}

          <button
            type="submit"
            disabled={pending}
            className="rounded-lg py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            style={{ backgroundColor: primaryColor }}
          >
            {pending ? "Working…" : mode === "magic-link" ? "Email me a link" : "Sign in"}
          </button>

          <p className="text-center text-xs text-muted-foreground">
            New customer?{" "}
            <a href="/register" className="underline" style={{ color: primaryColor }}>
              Create an account
            </a>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
