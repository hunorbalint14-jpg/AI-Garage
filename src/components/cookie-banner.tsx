"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const STORAGE_KEY = "ai-garage-cookies-acknowledged";

export function CookieBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time client-only mount check (localStorage); SSR-safe by design
    if (!localStorage.getItem(STORAGE_KEY)) setShow(true);
  }, []);

  function acknowledge() {
    localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    setShow(false);
  }

  if (!show) return null;

  return (
    <div
      role="dialog"
      aria-label="Cookie notice"
      className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-2xl rounded-lg border border-gray-200 bg-white p-4 shadow-lg sm:bottom-6 sm:left-6 sm:right-auto sm:p-5"
    >
      <p className="text-sm text-gray-700">
        We use essential cookies to keep you signed in and remember preferences. No tracking or
        advertising cookies.{" "}
        <Link href="/privacy" className="underline" target="_blank" rel="noopener noreferrer">
          Read our privacy policy
        </Link>
        .
      </p>
      <div className="mt-3 flex justify-end">
        <button
          onClick={acknowledge}
          className="rounded-md bg-gray-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-700"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
