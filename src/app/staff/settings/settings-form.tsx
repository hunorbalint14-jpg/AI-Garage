"use client";

import { useState, useTransition } from "react";
import { updateOrganization } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  initialName: string;
  initialColor: string;
  initialLogoUrl: string;
  canEdit: boolean;
};

export function SettingsForm({
  initialName,
  initialColor,
  initialLogoUrl,
  canEdit,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [color, setColor] = useState(initialColor);

  function handleSubmit(formData: FormData) {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateOrganization(formData);
      if ("error" in result) {
        setError(result.error);
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    });
  }

  return (
    <section className="rounded-lg border p-4">
      <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-muted-foreground">
        Branding
      </h2>
      <form action={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="name">Business name</Label>
          <Input
            id="name"
            name="name"
            defaultValue={initialName}
            required
            disabled={!canEdit}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="primaryColor">Primary colour</Label>
          <div className="flex items-center gap-3">
            <input
              id="primaryColor"
              name="primaryColor"
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              disabled={!canEdit}
              className="h-9 w-16 cursor-pointer rounded border bg-transparent p-0.5"
            />
            <span className="font-mono text-sm text-muted-foreground">
              {color}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Used for headings and buttons on your customer-facing pages.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="logoUrl">Logo URL (optional)</Label>
          <Input
            id="logoUrl"
            name="logoUrl"
            type="url"
            defaultValue={initialLogoUrl}
            placeholder="https://example.com/logo.png"
            disabled={!canEdit}
          />
          <p className="text-xs text-muted-foreground">
            Paste a public URL to your logo image. File upload coming soon.
          </p>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {saved && (
          <p className="text-sm text-green-700">Settings saved successfully.</p>
        )}

        {canEdit ? (
          <Button type="submit" disabled={pending} className="self-start">
            {pending ? "Saving…" : "Save changes"}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">
            Only organisation owners can edit settings.
          </p>
        )}
      </form>
    </section>
  );
}
