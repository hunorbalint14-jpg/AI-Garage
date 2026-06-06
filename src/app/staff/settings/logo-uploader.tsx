"use client";

import { useRef, useState, useTransition } from "react";
import Image from "next/image";
import { Upload, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { uploadOrgLogo, removeOrgLogo } from "./logo-actions";

export function LogoUploader({
  initialUrl,
  canEdit,
}: {
  initialUrl: string | null;
  canEdit: boolean;
}) {
  const [url, setUrl] = useState<string | null>(initialUrl);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File) {
    setError(null);
    setSaved(false);
    const formData = new FormData();
    formData.set("logo", file);
    start(async () => {
      const result = await uploadOrgLogo(formData);
      if ("error" in result) {
        setError(result.error);
      } else {
        setUrl(result.url);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    });
  }

  function handlePick() {
    inputRef.current?.click();
  }

  function handleRemove() {
    if (!confirm("Remove the current logo?")) return;
    setError(null);
    start(async () => {
      const result = await removeOrgLogo();
      if ("error" in result) setError(result.error);
      else setUrl(null);
    });
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (!canEdit) return;
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-4">
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          className="grid h-20 w-20 shrink-0 place-items-center rounded-lg border border-dashed bg-muted/30"
        >
          {url ? (
            <Image
              src={url}
              alt="Logo"
              width={72}
              height={72}
              unoptimized
              className="max-h-[72px] max-w-[72px] object-contain"
            />
          ) : (
            <span className="text-xs text-muted-foreground">No logo</span>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="hidden"
              disabled={!canEdit || pending}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
                e.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="outline"
              onClick={handlePick}
              disabled={!canEdit}
              loading={pending}
            >
              <Upload className="mr-1.5 h-4 w-4" />
              {url ? "Replace" : "Upload"}
            </Button>
            {url && canEdit && (
              <Button
                type="button"
                variant="outline"
                onClick={handleRemove}
                disabled={pending}
                className="text-red-600"
              >
                <Trash2 className="mr-1.5 h-4 w-4" />
                Remove
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            PNG, JPG, WEBP, or SVG · max 2 MB. Or drag-and-drop onto the box.
          </p>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {saved && <p className="text-sm text-green-700">Logo updated.</p>}
    </div>
  );
}
