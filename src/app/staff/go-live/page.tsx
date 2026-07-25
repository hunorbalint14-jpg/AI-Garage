import Link from "next/link";
import { CheckCircle2, Circle, Radio } from "lucide-react";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/staff/page-header";
import { MicroLabel, WorkshopBadge } from "@/components/staff/workshop";
import { loadSetupChecklist } from "@/lib/setup-checklist";
import { fetchHeldSummary, STALE_AFTER_HOURS } from "@/lib/held-comms";
import { isLocationLive } from "@/lib/prelive";
import { GoLiveButton } from "./go-live-button";
import { FirstRunForm } from "./first-run-form";

export const dynamic = "force-dynamic";

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

export default async function GoLivePage() {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();
  const live = isLocationLive(ctx.activeLocation);

  const [checklist, held, policyRes, debtRes] = await Promise.all([
    loadSetupChecklist(admin, ctx),
    fetchHeldSummary(admin, ctx.activeLocation.id),
    admin
      .from("locations")
      .select("first_run_cap, chase_prelive_debt")
      .eq("id", ctx.activeLocation.id)
      .maybeSingle(),
    // Invoices that would count as pre-live debt the moment this branch goes
    // live — context for the opt-in below.
    admin
      .from("invoices")
      .select("id", { count: "exact", head: true })
      .eq("location_id", ctx.activeLocation.id)
      .eq("status", "sent")
      .eq("is_demo", false)
      .is("paid_at", null)
      .lt("due_at", new Date().toISOString()),
  ]);

  const policy = (policyRes.data ?? { first_run_cap: null, chase_prelive_debt: false }) as {
    first_run_cap: number | null;
    chase_prelive_debt: boolean | null;
  };
  const preliveDebtCount = debtRes.count ?? 0;

  // loadSetupChecklist returns null once the card is complete or dismissed —
  // either way there's nothing outstanding to show here.
  const outstanding = checklist?.steps.filter((s) => !s.done && !s.optional) ?? [];

  if (live) {
    return (
      <div className="flex flex-col gap-6 max-w-2xl">
        <PageHeader title="Go live" description="This branch is already live." />
        <div className="rounded-lg border border-ws-green-border bg-ws-green-bg px-4 py-3">
          <p className="text-sm font-medium text-ws-green">
            {ctx.activeLocation.name} went live{ctx.activeLocation.live_at ? ` on ${fmtDate(ctx.activeLocation.live_at)}` : ""}.
          </p>
          <p className="mt-1 text-sm text-ws-text-2">
            Automatic messages to customers are running normally. Turn individual ones off in{" "}
            <Link href="/staff/automations" className="underline">
              Automations
            </Link>
            .
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <PageHeader
        title="Go live"
        description={`${ctx.activeLocation.name} is prelive — nothing automatic has gone to a customer yet. Here's what happens when you flip the switch.`}
      />

      <section className="rounded-lg border p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <MicroLabel>What will send</MicroLabel>
          <WorkshopBadge tone={held.total > 0 ? "amber" : "neutral"}>
            {held.total} waiting
          </WorkshopBadge>
        </div>

        {held.total === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing is waiting. Either there&apos;s no customer data due a message yet, or the scheduled runs haven&apos;t
            reached this branch — they check daily, so give it until tomorrow if you&apos;ve just imported.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              These have been held while you set up. Going live doesn&apos;t send them instantly — they go with the next
              scheduled run for each type.
            </p>
            <ul className="flex flex-col gap-3">
              {held.groups.map((g) => (
                <li key={g.kind} className="rounded-md border bg-ws-hover/30 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium">{g.label}</span>
                    <span className="tabular-nums text-sm">{g.count}</span>
                  </div>
                  <ul className="mt-1.5 flex flex-col gap-0.5">
                    {g.samples.map((s, i) => (
                      <li key={i} className="truncate text-xs text-muted-foreground">
                        {s}
                      </li>
                    ))}
                    {g.count > g.samples.length && (
                      <li className="text-xs text-muted-foreground">
                        …and {g.count - g.samples.length} more
                      </li>
                    )}
                  </ul>
                </li>
              ))}
            </ul>
            {policy.first_run_cap != null && held.total > policy.first_run_cap && (
              <p className="text-xs text-ws-amber">
                Your first-day limit is {policy.first_run_cap}, so roughly {policy.first_run_cap} go out on day one and
                the remaining {held.total - policy.first_run_cap} follow on the runs after.
              </p>
            )}
            {held.oldestAt && (
              <p className="text-xs text-muted-foreground">
                Oldest held since {fmtDate(held.oldestAt)}. Counts cover what the scheduled runs have confirmed in the
                last {STALE_AFTER_HOURS} hours, so anything since paid or cancelled drops off on its own.
              </p>
            )}
          </>
        )}
      </section>

      <section className="rounded-lg border p-4 flex flex-col gap-3">
        <MicroLabel>How it&apos;s released</MicroLabel>
        <p className="text-sm text-muted-foreground">
          Going live doesn&apos;t have to mean everything at once. These two decide how the backlog comes out.
        </p>
        <FirstRunForm
          cap={policy.first_run_cap}
          chasePreliveDebt={!!policy.chase_prelive_debt}
          preliveDebtCount={preliveDebtCount}
          canEdit={ctx.orgRole === "owner"}
        />
      </section>

      <section className="rounded-lg border p-4 flex flex-col gap-3">
        <MicroLabel>Before you go</MicroLabel>
        {outstanding.length === 0 ? (
          <p className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="h-4 w-4 text-ws-green" aria-hidden />
            Setup is complete.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              These aren&apos;t compulsory — you can go live with them outstanding — but customers notice them.
            </p>
            <ul className="flex flex-col gap-1.5">
              {outstanding.map((s) => (
                <li key={s.key} className="flex items-start gap-2 text-sm">
                  <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  {s.href ? (
                    <Link href={s.href} className="underline">
                      {s.label}
                    </Link>
                  ) : (
                    <span>{s.label}</span>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="rounded-lg border border-ws-blue-border bg-ws-blue-bg p-4 flex flex-col gap-3">
        <p className="flex items-center gap-2 text-sm font-medium text-ws-blue">
          <Radio className="h-4 w-4" aria-hidden /> Ready when you are
        </p>
        <p className="text-sm text-ws-text-2">
          Going live starts automatic messages to your customers. It can&apos;t be undone from here — if you need to
          pause afterwards, switch the individual automations off.
        </p>
        <GoLiveButton
          locationName={ctx.activeLocation.name}
          pending={held.total}
          firstDayCap={policy.first_run_cap}
          canGoLive={ctx.orgRole === "owner"}
        />
      </section>
    </div>
  );
}
