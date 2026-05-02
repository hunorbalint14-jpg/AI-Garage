"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type Mode = "magic-link" | "password";

export function CustomerLoginForm({ garageName }: { garageName: string }) {
  const router = useRouter();
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
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) setError(error.message);
      else setMessage("Check your email for the sign-in link.");
    } else {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) setError(error.message);
      else router.push("/");
    }
    setPending(false);
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Sign in to {garageName}</CardTitle>
        <CardDescription>
          Use a one-time email link or your password.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex gap-2 text-sm">
          <button
            type="button"
            onClick={() => setMode("magic-link")}
            className={`rounded px-3 py-1 ${mode === "magic-link" ? "bg-primary text-primary-foreground" : "bg-muted"}`}
          >
            Email link
          </button>
          <button
            type="button"
            onClick={() => setMode("password")}
            className={`rounded px-3 py-1 ${mode === "password" ? "bg-primary text-primary-foreground" : "bg-muted"}`}
          >
            Password
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
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
            <div className="flex flex-col gap-2">
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
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
          {message && <p className="text-sm text-green-700">{message}</p>}

          <Button type="submit" disabled={pending}>
            {pending
              ? "Working…"
              : mode === "magic-link"
                ? "Email me a link"
                : "Sign in"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
