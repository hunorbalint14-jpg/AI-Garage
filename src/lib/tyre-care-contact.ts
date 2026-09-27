import type { createAdminClient } from "@/lib/supabase/admin";
import { contactCapStatus, type ContactCap } from "@/lib/tyre-care-messages";

// Who has heard from us lately (#596 PR 5). Feeds the 30-day / yearly
// guardrail both on the queue page (shown before anyone clicks) and in the
// send action (enforced at click time). Counts automated nudges only:
// booking confirmations and manual one-off messages share the `custom`
// reminders type and aren't nagging, so they're deliberately left out.

type Admin = ReturnType<typeof createAdminClient>;

const DAY_MS = 24 * 60 * 60 * 1000;

const REMINDER_KIND: Record<string, string> = {
  mot: "MOT reminder",
  service: "service reminder",
  tax: "tax reminder",
  campaign: "campaign",
  tyre_care: "tyre-care message",
};

export type ContactState = { cap: ContactCap };

type Latest = { at: string; kind: string };

function newer(a: Latest | undefined, b: Latest): Latest {
  return !a || Date.parse(b.at) > Date.parse(a.at) ? b : a;
}

export async function loadContactStates(
  admin: Admin,
  customerIds: string[],
  now: Date = new Date(),
): Promise<Map<string, ContactState>> {
  const ids = [...new Set(customerIds)];
  const out = new Map<string, ContactState>();
  if (ids.length === 0) return out;

  const windowStart = new Date(now.getTime() - 30 * DAY_MS).toISOString();
  const yearStart = new Date(now.getTime() - 365 * DAY_MS).toISOString();

  const [reminders, reviews, deferred, tyreSends] = await Promise.all([
    admin
      .from("reminders")
      .select("customer_id, type, sent_at")
      .in("customer_id", ids)
      .eq("status", "sent")
      .in("type", Object.keys(REMINDER_KIND))
      .gte("sent_at", windowStart),
    admin
      .from("review_requests")
      .select("customer_id, sent_at")
      .in("customer_id", ids)
      .in("status", ["sent", "responded"])
      .gte("sent_at", windowStart),
    admin
      .from("deferred_work")
      .select("customer_id, last_followup_at")
      .in("customer_id", ids)
      .gte("last_followup_at", windowStart),
    admin
      .from("tyre_recommendations")
      .select("customer_id, sent_at")
      .in("customer_id", ids)
      .gte("sent_at", yearStart),
  ]);
  for (const r of [reminders, reviews, deferred, tyreSends]) {
    // A cap we can't read must not quietly let a message through.
    if (r.error) throw new Error(`contact state: ${r.error.message}`);
  }

  const latest = new Map<string, Latest>();
  for (const r of (reminders.data ?? []) as { customer_id: string; type: string; sent_at: string }[]) {
    latest.set(r.customer_id, newer(latest.get(r.customer_id), { at: r.sent_at, kind: REMINDER_KIND[r.type] ?? r.type }));
  }
  for (const r of (reviews.data ?? []) as { customer_id: string; sent_at: string }[]) {
    latest.set(r.customer_id, newer(latest.get(r.customer_id), { at: r.sent_at, kind: "feedback request" }));
  }
  for (const r of (deferred.data ?? []) as { customer_id: string; last_followup_at: string }[]) {
    latest.set(
      r.customer_id,
      newer(latest.get(r.customer_id), { at: r.last_followup_at, kind: "deferred-work follow-up" }),
    );
  }
  const yearly = new Map<string, number>();
  for (const r of (tyreSends.data ?? []) as { customer_id: string; sent_at: string }[]) {
    yearly.set(r.customer_id, (yearly.get(r.customer_id) ?? 0) + 1);
    // The recommendation's own sent_at is a second record of a tyre-care send:
    // the cap still holds if the matching reminders row failed to write.
    if (Date.parse(r.sent_at) >= Date.parse(windowStart)) {
      latest.set(r.customer_id, newer(latest.get(r.customer_id), { at: r.sent_at, kind: "tyre-care message" }));
    }
  }

  for (const id of ids) {
    const last = latest.get(id);
    out.set(id, {
      cap: contactCapStatus({
        lastContactedAt: last?.at ?? null,
        lastContactKind: last?.kind ?? null,
        tyreCareSendsLastYear: yearly.get(id) ?? 0,
        now,
      }),
    });
  }
  return out;
}
