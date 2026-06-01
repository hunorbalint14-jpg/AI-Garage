"use client";

import { useState, useTransition } from "react";
import { submitReview } from "./actions";

export function ReviewForm({ token, accent }: { token: string; accent: string }) {
  const [score, setScore] = useState(0);
  const [hover, setHover] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<null | "low" | "high">(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit() {
    if (score < 1) {
      setError("Please choose a rating first.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await submitReview(token, score, feedback);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      if (res.redirectTo) {
        window.location.assign(res.redirectTo);
        return;
      }
      setDone(res.lowScore ? "low" : "high");
    });
  }

  if (done) {
    return (
      <div className="text-center">
        <div className="mb-3 text-4xl">{done === "low" ? "🙏" : "⭐"}</div>
        <h2 className="text-lg font-semibold text-gray-900">Thank you for your feedback</h2>
        <p className="mt-2 text-sm text-gray-600">
          {done === "low"
            ? "We're sorry it wasn't perfect — the team has been notified and will look into it."
            : "We really appreciate you taking the time."}
        </p>
      </div>
    );
  }

  const active = hover || score;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex justify-center gap-1.5" role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            aria-label={`${n} star${n > 1 ? "s" : ""}`}
            aria-checked={score === n}
            role="radio"
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(0)}
            onClick={() => setScore(n)}
            className="text-4xl leading-none transition-transform hover:scale-110"
            style={{ color: n <= active ? accent : "#d1d5db" }}
          >
            ★
          </button>
        ))}
      </div>

      <textarea
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        rows={3}
        maxLength={2000}
        placeholder="Anything you'd like to add? (optional)"
        className="w-full rounded-lg border border-gray-300 p-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2"
        style={{ ["--tw-ring-color" as string]: accent }}
      />

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={pending}
        className="rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition-opacity disabled:opacity-60"
        style={{ backgroundColor: accent }}
      >
        {pending ? "Submitting…" : "Submit feedback"}
      </button>
    </div>
  );
}
