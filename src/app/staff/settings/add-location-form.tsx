"use client";

import { useState, useTransition } from "react";
import { addLocation } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const ROOT = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localtest.me:3000";
const ROOT_HOST = ROOT.split(":")[0];

export function AddLocationForm() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [slug, setSlug] = useState("");
  const [done, setDone] = useState<string | null>(null);

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await addLocation(formData);
      if ("error" in result) {
        setError(result.error);
      } else {
        setDone(result.slug);
        setOpen(false);
        setSlug("");
      }
    });
  }

  if (done) {
    return (
      <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
        Location created! Staff can now access it at{" "}
        <strong>
          {done}.{ROOT_HOST}
        </strong>
        .{" "}
        <button
          className="underline"
          onClick={() => setDone(null)}
        >
          Add another
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
      >
        + Add location
      </Button>
    );
  }

  return (
    <form action={handleSubmit} className="flex flex-col gap-3 rounded-lg border p-4">
      <p className="text-sm font-medium">New location</p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="locName">Location name</Label>
        <Input id="locName" name="name" placeholder="Bristol Branch" required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="locSlug">Subdomain</Label>
        <Input
          id="locSlug"
          name="slug"
          placeholder="bristol-branch"
          required
          value={slug}
          onChange={(e) =>
            setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))
          }
          autoComplete="off"
        />
        <p className="text-xs text-muted-foreground">
          {slug || "slug"}.{ROOT_HOST}
        </p>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={pending}>
          Create location
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => { setOpen(false); setError(null); setSlug(""); }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
