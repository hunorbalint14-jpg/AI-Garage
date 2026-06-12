"use client";

import { useState, useTransition } from "react";
import { toggleTask, updateTaskSettings, updateSchedule, runTaskNow, type TaskType, type TaskSettings } from "./actions";
import { formatSchedule, type Frequency } from "@/lib/cron/schedule";

const CHANNELS = ["email", "sms", "whatsapp"] as const;
const DAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

type Task = {
  id: string;
  task_type: TaskType;
  enabled: boolean;
  settings: Record<string, unknown>;
  last_run_at: string | null;
  frequency: Frequency;
  hour: number;
  day_of_week: number | null;
  next_run_at: string | null;
};

const TASK_META: Record<TaskType, { label: string; description: string; audience: "customer" | "staff"; hasRemindDays: boolean; hasChannels: boolean; hasWindowDays: boolean; hasHoursBefore: boolean }> = {
  mot_reminders:     { label: "MOT reminders",      description: "Send customers a personalised AI reminder before their MOT expires.",          audience: "customer", hasRemindDays: true,  hasChannels: true,  hasWindowDays: false, hasHoursBefore: false },
  service_reminders: { label: "Service reminders",  description: "Remind customers when their vehicle service is due.",                          audience: "customer", hasRemindDays: true,  hasChannels: true,  hasWindowDays: false, hasHoursBefore: false },
  tax_reminders:     { label: "Road tax reminders", description: "Alert customers when their road tax (VED) renewal is due.",                    audience: "customer", hasRemindDays: true,  hasChannels: true,  hasWindowDays: false, hasHoursBefore: false },
  booking_confirmations: { label: "Booking confirmations", description: "The day before each booking, ask the customer to confirm or request a new time with one tap — fewer no-shows, earlier warning when plans change.", audience: "customer", hasRemindDays: false, hasChannels: true, hasWindowDays: false, hasHoursBefore: true },
  invoice_dunning:   { label: "Overdue invoice reminders", description: "Email customers an escalating reminder (with a Pay-now link) when an invoice is overdue, until it's paid.", audience: "customer", hasRemindDays: false, hasChannels: false, hasWindowDays: false, hasHoursBefore: false },
  review_requests:   { label: "Review requests", description: "After a job is completed, email the customer for feedback — happy ratings go to your Google review page, unhappy ones are flagged privately to staff.", audience: "customer", hasRemindDays: false, hasChannels: false, hasWindowDays: false, hasHoursBefore: false },
  weekly_digest:     { label: "Weekly staff digest","description": "Email org owners/admins a summary of upcoming MOTs and services.",            audience: "staff",    hasRemindDays: false, hasChannels: false, hasWindowDays: true,  hasHoursBefore: false },
};

export function TaskCard({ task, canEdit }: { task: Task; canEdit: boolean }) {
  const meta = TASK_META[task.task_type];
  const [enabled, setEnabled] = useState(task.enabled);
  const [remindDays, setRemindDays] = useState<number>((task.settings.remind_days_before as number) ?? 30);
  const [windowDays, setWindowDays] = useState<number>((task.settings.window_days as number) ?? 30);
  const [hoursBefore, setHoursBefore] = useState<number>((task.settings.hours_before as number) ?? 24);
  const [channels, setChannels] = useState<string[]>((task.settings.channels as string[]) ?? ["email", "sms"]);
  const [frequency, setFrequency] = useState<Frequency>(task.frequency);
  const [hour, setHour] = useState<number>(task.hour);
  const [dayOfWeek, setDayOfWeek] = useState<number>(task.day_of_week ?? 1);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [running, setRunning] = useState(false);
  const [, startTransition] = useTransition();

  function handleToggle() {
    if (!canEdit) return;
    const next = !enabled;
    setEnabled(next);
    startTransition(async () => {
      const res = await toggleTask(task.id, next);
      if ("error" in res) { setEnabled(!next); setError(res.error); }
    });
  }

  function toggleChannel(ch: string) {
    setChannels((prev) =>
      prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch],
    );
  }

  function handleSaveSettings() {
    setError(null);
    setSaved(false);
    const settings: TaskSettings = meta.hasRemindDays
      ? { remind_days_before: remindDays, channels }
      : meta.hasHoursBefore
        ? { hours_before: hoursBefore, channels }
        : { window_days: windowDays };
    startTransition(async () => {
      const [settingsRes, scheduleRes] = await Promise.all([
        updateTaskSettings(task.id, settings),
        updateSchedule(task.id, frequency, hour, frequency === "weekly" ? dayOfWeek : null),
      ]);
      if ("error" in settingsRes) { setError(settingsRes.error); return; }
      if ("error" in scheduleRes) { setError(scheduleRes.error); return; }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  }

  async function handleRunNow() {
    if (!canEdit || running) return;
    setRunning(true);
    setError(null);
    const res = await runTaskNow(task.task_type);
    if ("error" in res) setError(res.error);
    setRunning(false);
  }

  const audienceBadge = meta.audience === "customer"
    ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
    : "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300";

  return (
    <div className={`rounded-lg border transition-opacity ${enabled ? "" : "opacity-60"}`}>
      <div className="flex items-start justify-between gap-4 p-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="font-medium text-sm">{meta.label}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium uppercase tracking-wide ${audienceBadge}`}>
              {meta.audience}
            </span>
            {!enabled && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase tracking-wide font-medium">
                Paused
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{meta.description}</p>
          <div className="mt-1.5 flex items-center gap-3 flex-wrap">
            <span className="text-xs text-muted-foreground font-mono">{formatSchedule(task.frequency, task.hour, task.day_of_week)}</span>
            {task.next_run_at && (
              <span className="text-xs text-muted-foreground">
                Next: {new Date(task.next_run_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
            {task.last_run_at && (
              <span className="text-xs text-muted-foreground">
                Last run: {new Date(task.last_run_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {canEdit && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-xs text-muted-foreground underline hover:text-foreground"
            >
              {expanded ? "Close" : "Configure"}
            </button>
          )}
          <button
            onClick={handleToggle}
            disabled={!canEdit}
            aria-label={enabled ? "Pause task" : "Enable task"}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus:outline-none disabled:cursor-not-allowed ${enabled ? "bg-primary" : "bg-muted"}`}
          >
            <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${enabled ? "translate-x-4" : "translate-x-0"}`} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t px-4 py-3 flex flex-col gap-3 bg-muted/20">
          <div className="flex items-center gap-3 flex-wrap">
            <label className="text-xs text-muted-foreground w-36">Schedule</label>
            <select
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as Frequency)}
              disabled={!canEdit}
              className="rounded border bg-background px-2 py-1 text-sm disabled:opacity-50"
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
            {frequency === "weekly" && (
              <select
                value={dayOfWeek}
                onChange={(e) => setDayOfWeek(Number(e.target.value))}
                disabled={!canEdit}
                className="rounded border bg-background px-2 py-1 text-sm disabled:opacity-50"
              >
                {DAYS.map((d) => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </select>
            )}
            <span className="text-xs text-muted-foreground">at</span>
            <select
              value={hour}
              onChange={(e) => setHour(Number(e.target.value))}
              disabled={!canEdit}
              className="rounded border bg-background px-2 py-1 text-sm disabled:opacity-50"
            >
              {Array.from({ length: 24 }, (_, i) => (
                <option key={i} value={i}>{String(i).padStart(2, "0")}:00</option>
              ))}
            </select>
          </div>
          {meta.hasRemindDays && (
            <div className="flex items-center gap-3">
              <label className="text-xs text-muted-foreground w-36">Remind days before</label>
              <input
                type="number"
                min={1}
                max={90}
                value={remindDays}
                onChange={(e) => setRemindDays(Number(e.target.value))}
                disabled={!canEdit}
                className="w-20 rounded border bg-background px-2 py-1 text-sm disabled:opacity-50"
              />
              <span className="text-xs text-muted-foreground">days</span>
            </div>
          )}
          {meta.hasHoursBefore && (
            <div className="flex items-center gap-3">
              <label className="text-xs text-muted-foreground w-36">Send hours before</label>
              <input
                type="number"
                min={2}
                max={72}
                value={hoursBefore}
                onChange={(e) => setHoursBefore(Number(e.target.value))}
                disabled={!canEdit}
                className="w-20 rounded border bg-background px-2 py-1 text-sm disabled:opacity-50"
              />
              <span className="text-xs text-muted-foreground">hours</span>
            </div>
          )}
          {meta.hasWindowDays && (
            <div className="flex items-center gap-3">
              <label className="text-xs text-muted-foreground w-36">Report window</label>
              <input
                type="number"
                min={7}
                max={90}
                value={windowDays}
                onChange={(e) => setWindowDays(Number(e.target.value))}
                disabled={!canEdit}
                className="w-20 rounded border bg-background px-2 py-1 text-sm disabled:opacity-50"
              />
              <span className="text-xs text-muted-foreground">days ahead</span>
            </div>
          )}
          {meta.hasChannels && (
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-xs text-muted-foreground w-36">Channels</span>
              <div className="flex gap-2">
                {CHANNELS.map((ch) => (
                  <button
                    key={ch}
                    type="button"
                    disabled={!canEdit}
                    onClick={() => toggleChannel(ch)}
                    className={`rounded px-2.5 py-1 text-xs font-medium border transition-colors disabled:opacity-50 ${channels.includes(ch) ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground border-border"}`}
                  >
                    {ch}
                  </button>
                ))}
              </div>
            </div>
          )}
          {error && <p className="text-xs text-red-600">{error}</p>}
          {canEdit && (
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleSaveSettings}
                className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
              >
                {saved ? "Saved" : "Save settings"}
              </button>
              <button
                onClick={handleRunNow}
                disabled={running}
                className="rounded border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                {running ? "Running…" : "Run now"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
