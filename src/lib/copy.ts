/**
 * THE VOICE RULE (UX review F4) — how product copy speaks.
 *
 * The staff portal mixes two deliberate voices; the rule is when to use which:
 *
 * 1. MACHINE STATES → MONO TERMINAL.
 *    Empty states, counts, system status. JetBrains Mono, uppercase-ish,
 *    `//` prefix, colour --color-ws-text-3.
 *      e.g.  // NO BOOKINGS TODAY
 *            // NO VEHICLES DUE WITHIN 60 DAYS
 *
 * 2. GUIDANCE → HUMAN.
 *    Anything advising the user speaks plainly — sans-serif, sentence case.
 *      e.g.  Quiet day. Add a booking or chase the 3 open quotes.
 *
 * 3. NEVER BOTH IN ONE STRING.
 *    A terminal line may be FOLLOWED by a human line, never fused into one.
 *
 * 4. NUMBERS STATE IMPACT.
 *    Prefer "£860 · Today" over "high priority".
 *
 * 5. CUSTOMER-FACING SURFACES ARE ALWAYS HUMAN.
 *    The portal, booking widget and emails never use terminal styling and
 *    never use emoji.
 *
 * Section labels/microcaps in the staff portal use <MicroLabel> from
 * @/components/staff/workshop — not ad-hoc `uppercase tracking-wide` utility
 * stacks. Convert stragglers whenever you touch a screen.
 */

/** Render a machine-state line ("NO BOOKINGS TODAY" → "// NO BOOKINGS TODAY"). */
export function terminalLine(state: string): string {
  return `// ${state.toUpperCase()}`;
}
