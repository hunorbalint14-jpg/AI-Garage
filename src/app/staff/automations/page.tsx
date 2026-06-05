import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { FeatureGateBanner } from "@/components/staff/feature-gate-banner";
import { entitledTo, UPGRADE_MESSAGE } from "@/lib/tenant-plans";
import { ensureDefaultTasks, type TaskType } from "./actions";
import { TaskCard } from "./task-card";

export const dynamic = "force-dynamic";

type ScheduledTask = {
  id: string;
  task_type: TaskType;
  enabled: boolean;
  settings: Record<string, unknown>;
  last_run_at: string | null;
  frequency: "daily" | "weekly";
  hour: number;
  day_of_week: number | null;
  next_run_at: string | null;
};

const TASK_ORDER: TaskType[] = ["mot_reminders", "service_reminders", "tax_reminders", "invoice_dunning", "review_requests", "weekly_digest"];

export default async function AutomationsPage() {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();
  const canEdit = ctx.orgRole === "owner" || ctx.orgRole === "admin";

  await ensureDefaultTasks(ctx.location.id);

  const { data, error } = await admin
    .from("scheduled_tasks")
    .select("id, task_type, enabled, settings, last_run_at, frequency, hour, day_of_week, next_run_at")
    .eq("location_id", ctx.location.id)
    .order("created_at", { ascending: true });

  const tasks = (data ?? []) as ScheduledTask[];
  const sorted = TASK_ORDER.map((t) => tasks.find((r) => r.task_type === t)).filter(Boolean) as ScheduledTask[];

  const customerTasks = sorted.filter((t) => t.task_type !== "weekly_digest");
  const staffTasks = sorted.filter((t) => t.task_type === "weekly_digest");

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold">Automations</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Scheduled tasks that run automatically. Toggle, configure, or trigger manually.
        </p>
      </div>

      {!entitledTo(ctx.tenantBilling, "automations") && <FeatureGateBanner message={UPGRADE_MESSAGE.automations} />}

      {error && <p className="text-sm text-red-600">Failed to load: {error.message}</p>}

      <section className="flex flex-col gap-3">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Customer communications
        </h2>
        {customerTasks.map((t) => (
          <TaskCard key={t.id} task={t} canEdit={canEdit} />
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Internal / staff reports
        </h2>
        {staffTasks.map((t) => (
          <TaskCard key={t.id} task={t} canEdit={canEdit} />
        ))}
      </section>

      <p className="text-xs text-muted-foreground border-t pt-4">
        Schedules are fixed by Vercel Cron (vercel.json) and cannot be changed from the UI.
        Contact your developer to adjust timing.
      </p>
    </div>
  );
}
