import type { TyreRecommendation } from "@/lib/tyre-care";

// Point-of-service balancing prompt (#596 PR 4). Balancing has the weakest
// signal of the three tyre services — realistically attach-on-fit or
// symptom-driven — so it never messages a customer. It surfaces here instead,
// while the car is on the ramp and the tech can check it in minutes.

export function BalancePrompt({ recommendation }: { recommendation: TyreRecommendation }) {
  return (
    <section className="rounded-lg border border-ws-blue-border bg-ws-blue-bg px-4 py-3 flex flex-col gap-1">
      <h2 className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ws-blue">
        Worth checking while it&apos;s in · wheel balance
      </h2>
      <p className="text-sm text-ws-text-2">{recommendation.evidence.reason}</p>
      <p className="text-xs text-muted-foreground">
        Suggestion for the technician only — nothing is sent to the customer. Record it under the vehicle&apos;s wheel
        services if you balance the wheels.
      </p>
    </section>
  );
}
