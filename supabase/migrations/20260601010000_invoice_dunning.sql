-- Invoice dunning: track escalating overdue-payment reminders per invoice.
-- The dunning cron (/api/cron/dunning) sends a reminder and bumps these. A paid
-- invoice is excluded by the cron's query (status flips to 'paid' via the Stripe
-- webhook), so reminders stop automatically.

alter table public.invoices
  add column if not exists last_dunned_at timestamptz,
  add column if not exists dunning_count int not null default 0;

-- Allow the new scheduled_tasks task types (invoice_dunning now; review_requests
-- ships with the review-funnel work). scheduled_tasks is managed outside the
-- committed migrations, so drop whatever CHECK currently constrains task_type
-- (whatever its name) and re-add a comprehensive one. Guarded so the whole block
-- is a no-op if the table isn't present in this environment.
do $$
declare c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.scheduled_tasks'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%task_type%'
  loop
    execute format('alter table public.scheduled_tasks drop constraint %I', c.conname);
  end loop;

  alter table public.scheduled_tasks
    add constraint scheduled_tasks_task_type_check
    check (task_type in (
      'mot_reminders', 'service_reminders', 'tax_reminders',
      'weekly_digest', 'invoice_dunning', 'review_requests'
    ));
exception
  when undefined_table then null;
end $$;
