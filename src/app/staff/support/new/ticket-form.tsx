"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createSupportTicketAction } from "../actions";

const TYPE_OPTIONS = [
  { value: "bug", label: "Bug", hint: "Something is broken or behaving wrongly." },
  { value: "question", label: "Question", hint: "You're not sure how something works." },
  { value: "feature_request", label: "Feature request", hint: "Something AI Garage should do but doesn't yet." },
] as const;

export function TicketForm() {
  const [type, setType] = useState<string>("bug");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fromPathRef = useRef<HTMLInputElement>(null);

  // Capture where the user came from — lands in the ticket's context jsonb.
  useEffect(() => {
    if (fromPathRef.current && document.referrer) {
      try {
        fromPathRef.current.value = new URL(document.referrer).pathname;
      } catch {
        /* ignore malformed referrers */
      }
    }
  }, []);

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await createSupportTicketAction(formData);
      // On success the action redirects; only errors return.
      if (result && "error" in result) setError(result.error);
    });
  }

  const selected = TYPE_OPTIONS.find((o) => o.value === type);

  return (
    <form action={handleSubmit} className="flex max-w-2xl flex-col gap-5 rounded-xl border bg-card p-6">
      <input ref={fromPathRef} type="hidden" name="from_path" />

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium">What kind of ticket is this?</label>
        <div className="flex flex-wrap gap-2">
          {TYPE_OPTIONS.map((o) => (
            <label
              key={o.value}
              className={`cursor-pointer rounded-md border px-3 py-2 text-sm ${
                type === o.value ? "border-primary bg-primary/10 font-medium" : "hover:bg-muted"
              }`}
            >
              <input
                type="radio"
                name="type"
                value={o.value}
                checked={type === o.value}
                onChange={() => setType(o.value)}
                className="sr-only"
              />
              {o.label}
            </label>
          ))}
        </div>
        {selected && <p className="text-xs text-muted-foreground">{selected.hint}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="subject" className="text-sm font-medium">
          Subject
        </label>
        <input
          id="subject"
          name="subject"
          required
          minLength={3}
          maxLength={150}
          placeholder={type === "feature_request" ? "e.g. Export invoices as CSV" : "e.g. Booking widget shows wrong opening hours"}
          className="rounded-md border bg-background px-3 py-2 text-sm"
        />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="body" className="text-sm font-medium">
          {type === "feature_request" ? "What should it do, and why does it matter?" : "What happened?"}
        </label>
        <textarea
          id="body"
          name="body"
          required
          rows={7}
          maxLength={10000}
          placeholder={
            type === "bug"
              ? "What did you do, what did you expect, what happened instead? Include the registration/customer/job if relevant."
              : "The more detail the better."
          }
          className="rounded-md border bg-background px-3 py-2 text-sm"
        />
        <p className="text-xs text-muted-foreground">
          Your name, garage, branch and the page you came from are attached automatically.
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {pending ? "Sending…" : "Send ticket"}
        </button>
      </div>
    </form>
  );
}
