"use client";

import { useState, useTransition } from "react";
import { updateOrganization } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LogoUploader } from "./logo-uploader";

type Props = {
  initialName: string;
  initialColor: string;
  initialLogoUrl: string;
  initialPhone: string;
  initialGoogleReviewUrl: string;
  initialPrivacyPolicyUrl: string;
  canEdit: boolean;
};

export function SettingsForm({
  initialName,
  initialColor,
  initialLogoUrl,
  initialPhone,
  initialGoogleReviewUrl,
  initialPrivacyPolicyUrl,
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
        setTimeout(() => {
          setSaved(false);
          // Reload so the layout re-renders with the new theme
          window.location.reload();
        }, 800);
      }
    });
  }

  return (
    <section className="rounded-lg border p-4">
      <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-muted-foreground">
        Branding &amp; contact
      </h2>
      <form action={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="name">Business name</Label>
          <Input id="name" name="name" defaultValue={initialName} required disabled={!canEdit} />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="phone">Phone number (optional)</Label>
          <Input
            id="phone"
            name="phone"
            type="tel"
            defaultValue={initialPhone}
            placeholder="0117 123 4567"
            disabled={!canEdit}
          />
          <p className="text-xs text-muted-foreground">
            Included in reminder emails so customers know how to book in.
          </p>
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
            <span className="font-mono text-sm text-muted-foreground">{color}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Used across customer-facing pages and the portal theme accents.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label>Logo</Label>
          <LogoUploader initialUrl={initialLogoUrl || null} canEdit={canEdit} />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="googleReviewUrl">Google review URL (optional)</Label>
          <Input
            id="googleReviewUrl"
            name="googleReviewUrl"
            type="url"
            defaultValue={initialGoogleReviewUrl}
            placeholder="https://g.page/r/your-business/review"
            disabled={!canEdit}
          />
          <p className="text-xs text-muted-foreground">
            Used when sending post-service review requests to customers.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="privacyPolicyUrl">Privacy policy URL (GDPR)</Label>
          <Input
            id="privacyPolicyUrl"
            name="privacyPolicyUrl"
            type="url"
            defaultValue={initialPrivacyPolicyUrl}
            placeholder="https://yourgarage.co.uk/privacy"
            disabled={!canEdit}
          />
          <p className="text-xs text-muted-foreground">
            Linked from customer-facing emails and booking pages. Required for GDPR compliance.
          </p>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {saved && <p className="text-sm text-green-700">Saved — reloading…</p>}

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
