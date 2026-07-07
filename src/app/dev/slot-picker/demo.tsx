"use client";

import { useState } from "react";
import { SlotPicker } from "@/components/slot-picker";
import { addDays, type SlotDay } from "@/lib/slots";

// Deterministic week: today + 6 days, Sunday closed, a few taken slots.
function fixtureWeek(): SlotDay[] {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(today, i);
    const weekday = new Date(`${date}T12:00`).getDay();
    if (weekday === 0) return { date, open: false, slots: [] };
    const taken = new Set(i % 2 === 0 ? ["09:00", "10:30"] : ["14:00"]);
    const slots = ["08:00", "08:30", "09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "14:00", "14:30", "15:00", "15:30"]
      .map((time) => ({ time, available: !taken.has(time) }));
    return { date, open: true, openLabel: "08:00–18:00", slots };
  });
}

export function SlotPickerDemo() {
  const [lightValue, setLightValue] = useState<string | null>(null);
  const [darkValue, setDarkValue] = useState<string | null>(null);
  const week = fixtureWeek();

  return (
    <div className="mx-auto grid max-w-5xl gap-8 p-8 md:grid-cols-2">
      <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold text-gray-900">
          Light (booking widget) — selected: {lightValue ?? "—"}
        </h2>
        <SlotPicker
          locationId="00000000-0000-0000-0000-000000000000"
          durationMinutes={60}
          value={lightValue}
          onChange={setLightValue}
          theme="light"
          primaryColor="#b3372f"
          initialWeek={week}
        />
      </section>

      <section className="rounded-2xl border border-white/10 bg-[#050c1a] p-6">
        <h2 className="mb-4 text-sm font-semibold text-white">
          Dark (customer portal) — selected: {darkValue ?? "—"}
        </h2>
        <SlotPicker
          locationId="00000000-0000-0000-0000-000000000000"
          durationMinutes={60}
          value={darkValue}
          onChange={setDarkValue}
          theme="dark"
          primaryColor="#6366f1"
          initialWeek={week}
        />
      </section>
    </div>
  );
}
