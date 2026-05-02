"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { signUpGarage } from "./actions";
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

const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localtest.me:3000";
const ROOT_HOSTNAME = ROOT_DOMAIN.split(":")[0];

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
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Get started</CardTitle>
        <CardDescription>
          Create your garage&apos;s account. You&apos;ll get your own branded
          subdomain.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="businessName">Business name</Label>
            <Input id="businessName" name="businessName" required />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="slug">Subdomain</Label>
            <Input
              id="slug"
              name="slug"
              required
              value={slug}
              onChange={(e) =>
                setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))
              }
              placeholder="smith-motors"
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              {slug || "your-garage"}.{ROOT_HOSTNAME}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="ownerName">Your name</Label>
            <Input
              id="ownerName"
              name="ownerName"
              required
              autoComplete="name"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
            />
            <p className="text-xs text-muted-foreground">
              At least 6 characters.
            </p>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <Button type="submit" disabled={pending}>
            {pending ? "Creating your garage…" : "Create garage"}
          </Button>

          <p className="text-center text-xs text-muted-foreground">
            Already have an account?{" "}
            <Link href="/staff/login" className="underline">
              Staff sign in
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
