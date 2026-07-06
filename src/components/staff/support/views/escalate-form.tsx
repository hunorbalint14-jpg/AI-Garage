"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { TICKET_TYPES, TYPE_LABELS, type TicketType } from "@/lib/support-tickets-shared";
import {
  createSupportTicketAction,
  createShotUploadUrlAction,
} from "@/app/staff/support-widget/actions";
import { captureScreenshot, sentryEventId } from "../use-support-context";

export type EscalateFormState = {
  type: TicketType;
  subject: string;
  body: string;
  screenshotOn: boolean;
};

const CHIP =
  "rounded-[4px] border border-[#22262e] bg-[#0e1116] px-[7px] py-[3px] font-mono text-[9px] tracking-[.08em] text-[#9aa1ad]";

export function EscalateForm({
  pathname,
  role,
  branchName,
  buildSha,
  brandColor,
  onBrand,
  form,
  setForm,
  onBack,
  onSent,
}: {
  pathname: string;
  role: string;
  branchName: string;
  buildSha: string | null;
  brandColor: string;
  onBrand: string;
  form: EscalateFormState;
  setForm: React.Dispatch<React.SetStateAction<EscalateFormState>>;
  onBack: () => void;
  onSent: (ref: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [shot, setShot] = useState<Blob | null>(null);
  const [shotUrl, setShotUrl] = useState<string | null>(null);
  const [sentryId, setSentryId] = useState<string | null>(null);
  const captured = useRef(false);
  const shotUrlRef = useRef<string | null>(null);

  // Capture once per form open — the [data-support-widget] filter removes the
  // panel itself, so the image shows the page behind it. The object URL lives
  // in a ref so the unmount cleanup sees the real value, not the first
  // render's null.
  useEffect(() => {
    if (captured.current) return;
    captured.current = true;
    void captureScreenshot().then((blob) => {
      setShot(blob);
      if (blob) {
        shotUrlRef.current = URL.createObjectURL(blob);
        setShotUrl(shotUrlRef.current);
      }
    });
    void sentryEventId().then(setSentryId);
    return () => {
      if (shotUrlRef.current) URL.revokeObjectURL(shotUrlRef.current);
    };
  }, []);

  function submit() {
    setError(null);
    startTransition(async () => {
      let screenshotPath: string | null = null;
      if (form.screenshotOn && shot) {
        // Upload at submit, not capture — abandoned forms leave no orphans.
        // Any failure falls through: the ticket must still send.
        try {
          const minted = await createShotUploadUrlAction();
          if (!("error" in minted)) {
            const put = await fetch(minted.url, {
              method: "PUT",
              headers: { "Content-Type": "image/png", Authorization: `Bearer ${minted.token}` },
              body: shot,
            });
            if (put.ok) screenshotPath = minted.path;
          }
        } catch {
          /* send without the screenshot */
        }
      }

      const fd = new FormData();
      fd.set("type", form.type);
      fd.set("subject", form.subject);
      fd.set("body", form.body);
      fd.set("from_path", pathname);
      if (screenshotPath) fd.set("screenshot_path", screenshotPath);
      if (sentryId) fd.set("sentry_event_id", sentryId);

      const result = await createSupportTicketAction(fd);
      if ("error" in result) setError(result.error);
      else onSent(result.ref);
    });
  }

  return (
    <div className="flex flex-1 flex-col gap-[11px] overflow-y-auto p-3.5">
      <button
        onClick={onBack}
        className="self-start font-mono text-[10px] tracking-[.08em] text-[#5a6170] hover:text-[#e6e8eb]"
      >
        ← BACK TO ASSIST
      </button>
      <div className="text-[14px] font-semibold text-[#e6e8eb]">Raise a ticket</div>

      <div className="flex gap-1.5">
        {TICKET_TYPES.map((t) => (
          <button
            key={t}
            onClick={() => setForm((f) => ({ ...f, type: t }))}
            className="rounded-[7px] px-[11px] py-[7px] text-[12px]"
            style={
              form.type === t
                ? {
                    border: `1px solid ${brandColor}`,
                    background: `color-mix(in srgb, ${brandColor} 14%, transparent)`,
                    color: "#e6e8eb",
                    fontWeight: 600,
                  }
                : { border: "1px solid #2a2f37", color: "#9aa1ad" }
            }
          >
            {TYPE_LABELS[t]}
          </button>
        ))}
      </div>

      <label className="font-mono text-[9px] tracking-[.12em] text-[#5a6170]">
        SUBJECT
        <input
          value={form.subject}
          onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
          minLength={3}
          maxLength={150}
          className="mt-1 w-full rounded-lg border border-[#2a2f37] bg-[#0e1116] px-[11px] py-[9px] font-sans text-[13px] tracking-normal text-[#e6e8eb] outline-none"
        />
      </label>
      <label className="font-mono text-[9px] tracking-[.12em] text-[#5a6170]">
        WHAT&apos;S GOING ON?
        <textarea
          rows={5}
          value={form.body}
          onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
          maxLength={10000}
          className="mt-1 w-full resize-y rounded-lg border border-[#2a2f37] bg-[#0e1116] px-[11px] py-[9px] font-sans text-[13px] leading-normal tracking-normal text-[#e6e8eb] outline-none"
        />
      </label>

      <div className="rounded-lg border border-dashed border-[#2a2f37] p-2.5">
        <div className="mb-[7px] font-mono text-[9px] tracking-[.12em] text-[#5a6170]">
          ATTACHED AUTOMATICALLY
        </div>
        <div className="flex flex-wrap gap-[5px]">
          <span className={CHIP}>ROUTE {pathname.toUpperCase()}</span>
          <span className={CHIP}>BRANCH {branchName.toUpperCase()}</span>
          <span className={CHIP}>ROLE {role.toUpperCase()}</span>
          {buildSha && <span className={CHIP}>BUILD {buildSha.toUpperCase()}</span>}
          <span className={CHIP}>SENTRY · {sentryId ? "EVENT ATTACHED" : "NONE"}</span>
          <button
            onClick={() => setForm((f) => ({ ...f, screenshotOn: !f.screenshotOn }))}
            disabled={!shot}
            className="inline-flex items-center gap-[5px] rounded-[4px] bg-[#0e1116] px-[7px] py-[3px] font-mono text-[9px] tracking-[.08em] disabled:opacity-50"
            style={
              form.screenshotOn && shot
                ? { border: `1px solid ${brandColor}`, color: "#e6e8eb" }
                : { border: "1px solid #2a2f37", color: "#5a6170" }
            }
          >
            {shotUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={shotUrl} alt="" className="h-[10px] w-[15px] rounded-[2px] border border-[#3a4049] object-cover" />
            ) : (
              <span className="inline-block h-[10px] w-[15px] rounded-[2px] border border-[#3a4049] bg-gradient-to-br from-[#1c2026] to-[#2a313b]" />
            )}
            SCREENSHOT · {form.screenshotOn && shot ? "ATTACHED" : "OFF"}
          </button>
        </div>
      </div>

      {error && <p className="m-0 text-[12px] text-[#ff7b7b]">{error}</p>}

      <button
        onClick={submit}
        disabled={pending}
        className="rounded-lg py-2.5 text-[13px] font-semibold disabled:opacity-50"
        style={{ background: brandColor, color: onBrand }}
      >
        {pending ? "Sending…" : "Send to AI Garage"}
      </button>
      <div className="text-center font-mono text-[9px] tracking-[.08em] text-[#5a6170]">
        REPLIES LAND HERE AND BY EMAIL
      </div>
    </div>
  );
}
