"use client";

import { useState, useTransition } from "react";
import { updateOrganization } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Theme = "dark" | "light" | "glass" | "workshop";

const THEMES: { id: Theme; label: string; description: string; preview: string }[] = [
  {
    id: "dark",
    label: "Dark",
    description: "Animated blobs, dark sidebar, light content",
    preview: "bg-[#050c1a]",
  },
  {
    id: "light",
    label: "Light",
    description: "Clean white, no animation, professional",
    preview: "bg-white border border-gray-200",
  },
  {
    id: "glass",
    label: "Glass",
    description: "Transparent sidebar, strong brand blobs, glass content",
    preview: "bg-[#050c1a]",
  },
  {
    id: "workshop",
    label: "Workshop",
    description: "Industrial dark, amber accents, monospace details",
    preview: "bg-[#0e1014]",
  },
];

type Props = {
  initialName: string;
  initialColor: string;
  initialLogoUrl: string;
  initialPhone: string;
  initialTheme: Theme;
  initialGoogleReviewUrl: string;
  canEdit: boolean;
};

export function SettingsForm({
  initialName,
  initialColor,
  initialLogoUrl,
  initialPhone,
  initialTheme,
  initialGoogleReviewUrl,
  canEdit,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [color, setColor] = useState(initialColor);
  const [theme, setTheme] = useState<Theme>(initialTheme);

  function handleSubmit(formData: FormData) {
    setError(null);
    setSaved(false);
    formData.set("portalTheme", theme);
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
          <Label htmlFor="logoUrl">Logo URL (optional)</Label>
          <Input
            id="logoUrl"
            name="logoUrl"
            type="url"
            defaultValue={initialLogoUrl}
            placeholder="https://example.com/logo.png"
            disabled={!canEdit}
          />
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

        {/* ── Portal theme picker ── */}
        <div className="flex flex-col gap-2">
          <Label>Staff portal theme</Label>
          <div className="grid grid-cols-2 gap-3">
            {THEMES.map((t) => {
              const isSelected = theme === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  disabled={!canEdit}
                  onClick={() => setTheme(t.id)}
                  className={`flex flex-col overflow-hidden rounded-xl border-2 text-left transition-all disabled:opacity-50 ${
                    isSelected ? "border-primary shadow-sm" : "border-transparent hover:border-muted"
                  }`}
                >
                  {/* Mini preview */}
                  <div className={`relative flex h-16 w-full items-stretch overflow-hidden ${t.preview}`}>
                    {/* Blobs for dark/glass previews */}
                    {t.id !== "light" && t.id !== "workshop" && (
                      <>
                        <div
                          className="absolute -top-4 -left-4 h-12 w-12 rounded-full blur-xl opacity-60"
                          style={{ backgroundColor: color }}
                        />
                        <div
                          className="absolute bottom-0 right-0 h-10 w-10 rounded-full blur-lg opacity-40"
                          style={{ backgroundColor: color }}
                        />
                      </>
                    )}
                    {/* Sidebar strip */}
                    <div
                      className={`relative z-10 w-8 border-r ${
                        t.id === "workshop"
                          ? "bg-[#15181d] border-[#2a2f37]"
                          : t.id === "dark"
                          ? "bg-[#0a1020]/70 border-white/10"
                          : t.id === "light"
                          ? "bg-white border-gray-200"
                          : "bg-transparent border-white/10"
                      }`}
                    >
                      {[0, 1, 2].map((i) => (
                        <div
                          key={i}
                          className="mx-1 mt-1.5 h-1"
                          style={{
                            borderRadius: t.id === "workshop" ? 0 : 9999,
                            backgroundColor:
                              t.id === "workshop"
                                ? i === 0
                                  ? color
                                  : "#2a2f37"
                                : i === 0
                                ? color
                                : t.id === "light"
                                ? "#9ca3af"
                                : "rgba(255,255,255,0.3)",
                            opacity: i === 0 ? 1 : 0.6,
                          }}
                        />
                      ))}
                    </div>
                    {/* Content area */}
                    <div
                      className={`relative z-10 flex-1 ${
                        t.id === "workshop"
                          ? "bg-[#0e1014]"
                          : t.id === "dark"
                          ? "bg-[#f8fafc]"
                          : t.id === "light"
                          ? "bg-gray-50"
                          : "bg-white/80 backdrop-blur"
                      }`}
                    />
                  </div>
                  <div className="border-t bg-card px-2 py-1.5">
                    <p className="text-xs font-semibold">{t.label}</p>
                    <p className="text-[10px] leading-tight text-muted-foreground">
                      {t.description}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
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
