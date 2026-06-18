"use client";

import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { AigSpinner } from "@/components/ui/aig-spinner";
import { saveOnboarding } from "./actions";
import {
  type AiProfileAnswers,
  SPECIALISM_OPTIONS,
  TONE_OPTIONS,
  SERVICE_OPTIONS,
  AMENITY_OPTIONS,
  DIAGNOSTIC_OPTIONS,
  BOOKING_PREFERENCE_OPTIONS,
} from "@/lib/ai-profile-shared";

const inputCls =
  "w-full rounded-lg border border-white/12 bg-white/[0.04] px-3 py-2 text-sm text-[#e6e8eb] placeholder:text-[#5a6170] focus:border-white/30 focus:outline-none disabled:opacity-50";

export function OnboardingForm({
  orgName,
  brandColor,
  initial,
  brief,
  isEdit,
}: {
  orgName: string;
  brandColor: string;
  initial: AiProfileAnswers;
  /** The current Claude-generated brief (read-only preview); null until first save. */
  brief: string | null;
  isEdit: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [a, setA] = useState<AiProfileAnswers>(initial);

  const set = <K extends keyof AiProfileAnswers>(k: K, v: AiProfileAnswers[K]) =>
    setA((p) => ({ ...p, [k]: v }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await saveOnboarding(a);
      if ("error" in res) setError(res.error);
      else {
        // Hard navigation so the dashboard shell loads cleanly from a fresh
        // document (this page is shell-bypassed; RSC nav out of it can glitch).
        window.location.assign("/staff");
      }
    });
  }

  return (
    <div className="min-h-screen bg-[#0e1014] text-[#e6e8eb] dark">
      <div className="mx-auto max-w-2xl px-5 py-10">
        <div className="mb-1 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[#5a6170]">
          <Sparkles className="h-3.5 w-3.5" style={{ color: brandColor }} />
          {orgName}
        </div>
        <h1 className="text-2xl font-bold tracking-tight">
          {isEdit ? "Edit your AI setup" : "Let's set up your AI assistant"}
        </h1>
        <p className="mt-1.5 text-sm text-[#9aa1ad]">
          A few questions about {orgName} so the AI receptionist, reminders, campaigns and diagnostics
          sound like you and only offer what you actually do. You can change these later in Settings.
        </p>

        {brief && brief.trim() && (
          <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <div className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[#5a6170]">
              <Sparkles className="h-3 w-3" style={{ color: brandColor }} />
              Current AI brief
            </div>
            <p className="whitespace-pre-line text-[13px] leading-relaxed text-[#c2c7cf]">{brief.trim()}</p>
            <p className="mt-3 text-[11px] text-[#5a6170]">
              Auto-generated from your answers below and used by every AI feature. Save to regenerate it.
            </p>
          </div>
        )}

        <form onSubmit={submit} className="mt-7 flex flex-col gap-7">
          <CheckGroup label="What does your garage specialise in?" options={SPECIALISM_OPTIONS}
            selected={a.specialisms} onChange={(arr) => set("specialisms", arr)} disabled={pending} />
          {a.specialisms.includes("Marque specialist") && (
            <Field label="Which marques?">
              <input className={inputCls} value={a.marques} disabled={pending}
                placeholder="e.g. BMW, Mini, Audi" onChange={(e) => set("marques", e.target.value)} />
            </Field>
          )}

          <Field label="Tone of voice for customer messages">
            <select className={inputCls} value={a.tone} disabled={pending} onChange={(e) => set("tone", e.target.value)}>
              {TONE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>

          <CheckGroup label="Services you offer" options={SERVICE_OPTIONS}
            selected={a.services} onChange={(arr) => set("services", arr)} disabled={pending} />
          <Field label="Signature / upsell services to promote (optional)">
            <input className={inputCls} value={a.signatureServices} disabled={pending}
              placeholder="e.g. winter health check, AC regas" onChange={(e) => set("signatureServices", e.target.value)} />
          </Field>

          <CheckGroup label="Amenities" options={AMENITY_OPTIONS}
            selected={a.amenities} onChange={(arr) => set("amenities", arr)} disabled={pending} />

          <Field label="Typical lead time for a booking (optional)">
            <input className={inputCls} value={a.leadTime} disabled={pending}
              placeholder="e.g. usually within 3–5 days" onChange={(e) => set("leadTime", e.target.value)} />
          </Field>

          <CheckGroup label="Diagnostic & specialist capabilities" options={DIAGNOSTIC_OPTIONS}
            selected={a.diagnostics} onChange={(arr) => set("diagnostics", arr)} disabled={pending} />

          <Field label="What do you NOT do? (so the AI never promises it)">
            <textarea className={inputCls} rows={2} value={a.doesNotDo} disabled={pending}
              placeholder="e.g. no bodywork, no HGV, no tyres under 16″" onChange={(e) => set("doesNotDo", e.target.value)} />
          </Field>

          <Field label="Parts policy (optional)">
            <input className={inputCls} value={a.partsPolicy} disabled={pending}
              placeholder="e.g. OEM where possible; customer-supplied parts not fitted" onChange={(e) => set("partsPolicy", e.target.value)} />
          </Field>
          <Field label="Tyres you sell (optional)">
            <input className={inputCls} value={a.tyres} disabled={pending}
              placeholder="e.g. budget to premium — Michelin, Continental, Avon" onChange={(e) => set("tyres", e.target.value)} />
          </Field>

          <Field label="How should customers book?">
            <select className={inputCls} value={a.bookingPreference} disabled={pending} onChange={(e) => set("bookingPreference", e.target.value)}>
              {BOOKING_PREFERENCE_OPTIONS.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </Field>

          <Field label="What do you like to promote? (optional)">
            <textarea className={inputCls} rows={2} value={a.promotions} disabled={pending}
              placeholder="e.g. seasonal MOT offers, winter checks, AC regas in spring" onChange={(e) => set("promotions", e.target.value)} />
          </Field>

          <Field label="Receptionist greeting / persona (optional)">
            <input className={inputCls} value={a.receptionistStyle} disabled={pending}
              placeholder='e.g. "Hi, you’re through to Alex at …" — warm, helpful' onChange={(e) => set("receptionistStyle", e.target.value)} />
          </Field>
          <Field label="When should the receptionist hand off to a human? (optional)">
            <input className={inputCls} value={a.escalation} disabled={pending}
              placeholder="e.g. complaints, breakdowns, anything urgent" onChange={(e) => set("escalation", e.target.value)} />
          </Field>

          <Field label="Anything the AI should NEVER say? (optional)">
            <textarea className={inputCls} rows={2} value={a.neverSay} disabled={pending}
              placeholder="e.g. never guarantee a pass, never quote firm prices over chat" onChange={(e) => set("neverSay", e.target.value)} />
          </Field>
          <Field label="Anything else worth knowing? (optional)">
            <textarea className={inputCls} rows={2} value={a.extraNotes} disabled={pending}
              onChange={(e) => set("extraNotes", e.target.value)} />
          </Field>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="sticky bottom-0 -mx-5 border-t border-[#2a2f37] bg-[#0e1014]/95 px-5 py-4 backdrop-blur">
            <button
              type="submit"
              disabled={pending}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              style={{ backgroundColor: brandColor }}
            >
              {pending && <AigSpinner />}
              {pending ? "Generating your AI assistant…" : isEdit ? "Save & regenerate" : "Finish setup & enter dashboard"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-[#e6e8eb]">{label}</span>
      {children}
    </label>
  );
}

function CheckGroup({
  label,
  options,
  selected,
  onChange,
  disabled,
}: {
  label: string;
  options: string[];
  selected: string[];
  // Receives the full next array (preset selections + any custom "Other" items).
  onChange: (next: string[]) => void;
  disabled: boolean;
}) {
  // Split the stored array into known presets and free-text "Other" entries.
  const presetSel = selected.filter((v) => options.includes(v));
  const customs = selected.filter((v) => !options.includes(v));
  const [otherOpen, setOtherOpen] = useState(customs.length > 0);
  const [otherText, setOtherText] = useState(customs.join(", "));

  const parse = (text: string) =>
    text
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  const emit = (presets: string[], text: string) => onChange([...presets, ...parse(text)]);

  const togglePreset = (o: string) => {
    const next = presetSel.includes(o) ? presetSel.filter((x) => x !== o) : [...presetSel, o];
    emit(next, otherText);
  };
  const toggleOther = () => {
    if (otherOpen) {
      setOtherOpen(false);
      setOtherText("");
      emit(presetSel, ""); // drop custom entries when "Other" is switched off
    } else {
      setOtherOpen(true);
    }
  };

  const chipCls = (on: boolean) =>
    "rounded-full border px-3 py-1.5 text-[13px] transition-colors disabled:opacity-50 " +
    (on
      ? "border-white/20 bg-white/[0.12] text-white font-medium"
      : "border-white/10 bg-white/[0.03] text-[#9aa1ad] hover:bg-white/[0.07]");

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-[#e6e8eb]">{label}</span>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button key={o} type="button" disabled={disabled} onClick={() => togglePreset(o)} aria-pressed={presetSel.includes(o)} className={chipCls(presetSel.includes(o))}>
            {o}
          </button>
        ))}
        <button type="button" disabled={disabled} onClick={toggleOther} aria-pressed={otherOpen} className={chipCls(otherOpen)}>
          + Other
        </button>
      </div>
      {otherOpen && (
        <input
          className={inputCls}
          value={otherText}
          disabled={disabled}
          placeholder="Add your own, separated by commas"
          onChange={(e) => {
            setOtherText(e.target.value);
            emit(presetSel, e.target.value);
          }}
        />
      )}
    </div>
  );
}
