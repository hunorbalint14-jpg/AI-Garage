-- dashboard_stats_v2: role-aware successor to dashboard_stats (20260611120000).
--
-- Changes vs v1:
--   * expiring_quotes reads the unified `quotes` table — v1 still counted the
--     dead `job_quotes` archive (frozen since the unified-quotes cutover, and
--     a hard break once Phase 10 drops the archive tables).
--   * New always-on ops aggregates: quotes_pending, courtesy, low_stock,
--     no_show_today.
--   * New gated sections, CASE-wrapped so the untaken branch never executes
--     (mechanic-shaped calls cost roughly what v1 did):
--       wip          — p_include_finance
--       finance      — p_include_owner (same expressions as revenue_stats)
--       week_worked  — p_include_owner
--       my_day       — p_user_id is not null
--   * my_day subqueries predicate on BOTH location_id and the user column, so
--     a stale branch cookie can never surface another branch's rows.
--
-- v1 is left in place for the deploy window (old serverless instances still
-- call it); a later cleanup migration drops it — before quotes Phase 10.
--
-- Service-role only, plain `language sql stable` (NOT security definer):
-- tenant isolation is the caller's responsibility. p_location_id and
-- p_user_id must always be server-derived (ctx.location.id / ctx.user.id).

-- The WIP sum walks job_items by job; nothing indexed job_id until now.
create index if not exists job_items_job_idx on public.job_items (job_id);
-- Week-worked sum scans time entries by branch + window (reports page pays
-- this cost today too).
create index if not exists job_time_entries_location_started_idx
  on public.job_time_entries (location_id, started_at);

create or replace function public.dashboard_stats_v2(
  p_location_id uuid,
  p_now timestamptz,
  p_today_start timestamptz,
  p_today_end timestamptz,
  p_week_start timestamptz,
  p_week_end timestamptz,
  p_due_cutoff date,
  p_quote_cutoff timestamptz,
  p_month_start timestamptz,
  p_eight_weeks_ago timestamptz,
  p_user_id uuid default null,
  p_include_finance boolean default true,
  p_include_owner boolean default false
)
returns jsonb
language sql
stable
set search_path = public
as $body$
select jsonb_build_object(
  -- Customers are org-scoped; per-branch figures use the home branch
  -- (preferred_location_id), matching the 20260614180000 re-point of v1.
  'total_customers',
    (select count(*) from customers where preferred_location_id = p_location_id),
  'total_vehicles',
    (select count(*) from vehicles where location_id = p_location_id),
  'reminders_month',
    (select count(*) from reminders
      where location_id = p_location_id and sent_at >= p_month_start),
  'active_jobs',
    (select count(*) from jobs
      where location_id = p_location_id and status = 'open'),
  'uninvoiced_jobs',
    (select count(*) from jobs
      where location_id = p_location_id and status = 'complete'),
  'invoices_open', (
    select jsonb_build_object(
      'draft_count', count(*) filter (where status = 'draft'),
      'draft_total', coalesce(sum(total) filter (where status = 'draft'), 0),
      'sent_count',  count(*) filter (where status = 'sent'),
      'sent_total',  coalesce(sum(total) filter (where status = 'sent'), 0)
    )
    from invoices
    where location_id = p_location_id and status in ('draft', 'sent')
  ),
  'expiring_quotes', (
    select jsonb_build_object(
      'count', count(*),
      'total', coalesce(sum(total), 0)
    )
    from quotes
    where location_id = p_location_id
      and status = 'pending'
      and expires_at <= p_quote_cutoff
  ),
  'quotes_pending', (
    select jsonb_build_object(
      'count', count(*),
      'total', coalesce(sum(total), 0)
    )
    from quotes
    where location_id = p_location_id and status = 'pending'
  ),
  'courtesy', (
    select jsonb_build_object(
      'out_count', count(*),
      'overdue_count', count(*) filter
        (where due_back_at is not null and due_back_at < p_now)
    )
    from courtesy_car_loans
    where location_id = p_location_id and returned_at is null
  ),
  -- Same rule as src/lib/inventory.ts isLowStock; active products only (the
  -- dashboard tile carries an "active products" sub-label for this reason).
  'low_stock', (
    select count(*) from products
    where location_id = p_location_id
      and active
      and reorder_at is not null
      and stock_qty <= reorder_at
  ),
  'no_show_today', (
    select count(*) from bookings
    where location_id = p_location_id
      and status = 'no_show'
      and scheduled_at >= p_today_start
      and scheduled_at <= p_today_end
  ),
  'wip', case when p_include_finance then (
    select jsonb_build_object(
      'job_count', count(distinct j.id),
      'total', coalesce(sum(ji.quantity * ji.unit_price), 0)
    )
    from jobs j
    left join job_items ji on ji.job_id = j.id
    where j.location_id = p_location_id and j.status = 'open'
  ) else null end,
  -- Same expressions as revenue_stats so the owner tiles agree with /staff/revenue.
  'finance', case when p_include_owner then (
    select jsonb_build_object(
      'revenue_month', coalesce(sum(total) filter
        (where status = 'paid' and paid_at >= date_trunc('month', p_now)), 0),
      'total_paid',    coalesce(sum(total) filter (where status = 'paid'), 0),
      'paid_count',    count(*) filter (where status = 'paid'),
      'aged_overdue',  coalesce(sum(total) filter
        (where status not in ('paid', 'draft') and due_at < p_now), 0)
    )
    from invoices
    where location_id = p_location_id
  ) else null end,
  'week_worked', case when p_include_owner then (
    select jsonb_build_object(
      'minutes', coalesce(sum(duration_minutes), 0),
      'techs',   count(distinct user_id)
    )
    from job_time_entries
    where location_id = p_location_id
      and started_at >= p_week_start
      and started_at <= p_week_end
      and duration_minutes is not null
  ) else null end,
  'my_day', case when p_user_id is not null then jsonb_build_object(
    'bookings', (
      select coalesce(jsonb_agg(t.r order by t.scheduled_at asc), '[]'::jsonb)
      from (
        select b.scheduled_at,
          jsonb_build_object(
            'id', b.id,
            'scheduled_at', b.scheduled_at,
            'duration_minutes', b.duration_minutes,
            'type', b.type,
            'status', b.status,
            'registration', v.registration,
            'customer_name', c.full_name,
            'bay_id', b.bay_id
          ) as r
        from bookings b
        left join customers c on c.id = b.customer_id
        left join vehicles v on v.id = b.vehicle_id
        where b.location_id = p_location_id
          and b.assigned_to = p_user_id
          and b.scheduled_at >= p_today_start
          and b.scheduled_at <= p_today_end
      ) t
    ),
    'jobs', (
      select coalesce(jsonb_agg(t.r order by t.created_at desc), '[]'::jsonb)
      from (
        select j.created_at,
          jsonb_build_object(
            'id', j.id,
            'description', j.description,
            'status', j.status,
            'registration', v.registration,
            'customer_name', c.full_name
          ) as r
        from jobs j
        left join customers c on c.id = j.customer_id
        left join vehicles v on v.id = j.vehicle_id
        where j.location_id = p_location_id
          and j.assigned_to = p_user_id
          and j.status = 'open'
        order by j.created_at desc
        limit 10
      ) t
    ),
    'open_entry', (
      select jsonb_build_object(
        'job_id', te.job_id,
        'status', te.status,
        'active_minutes', te.active_minutes,
        'segment_started_at', te.segment_started_at,
        'job_description', j.description,
        'registration', v.registration
      )
      from job_time_entries te
      join jobs j on j.id = te.job_id
      left join vehicles v on v.id = j.vehicle_id
      where te.user_id = p_user_id
        and te.location_id = p_location_id
        and te.ended_at is null
      limit 1
    )
  ) else null end,
  'attention_vehicles', (
    select coalesce(jsonb_agg(t.v_row order by t.mot_expiry asc nulls last), '[]'::jsonb)
    from (
      select v.mot_expiry,
        jsonb_build_object(
          'id', v.id,
          'registration', v.registration,
          'make', v.make,
          'model', v.model,
          'mot_expiry', v.mot_expiry,
          'service_due', v.service_due,
          'customer', case when c.id is null then null
            else jsonb_build_object('id', c.id, 'full_name', c.full_name) end
        ) as v_row
      from vehicles v
      left join customers c on c.id = v.customer_id
      where v.location_id = p_location_id
        and (v.mot_expiry <= p_due_cutoff or v.service_due <= p_due_cutoff)
      order by v.mot_expiry asc nulls last
      limit 20
    ) t
  ),
  'today_bookings', (
    select coalesce(jsonb_agg(t.b_row order by t.scheduled_at asc), '[]'::jsonb)
    from (
      select b.scheduled_at,
        jsonb_build_object(
          'id', b.id,
          'scheduled_at', b.scheduled_at,
          'duration_minutes', b.duration_minutes,
          'type', b.type,
          'status', b.status,
          'bay_id', b.bay_id,
          'customer', case when c.id is null then null
            else jsonb_build_object('id', c.id, 'full_name', c.full_name) end,
          'vehicle', case when v.id is null then null
            else jsonb_build_object('registration', v.registration) end
        ) as b_row
      from bookings b
      left join customers c on c.id = b.customer_id
      left join vehicles v on v.id = b.vehicle_id
      where b.location_id = p_location_id
        and b.scheduled_at >= p_today_start
        and b.scheduled_at <= p_today_end
    ) t
  ),
  'bays', (
    select coalesce(
      jsonb_agg(
        jsonb_build_object('id', id, 'name', name, 'description', description)
        order by sort_order asc, created_at asc
      ),
      '[]'::jsonb
    )
    from bays
    where location_id = p_location_id
  ),
  'business_hours', (
    select jsonb_build_object(
      'start', business_hours_start,
      'end', business_hours_end
    )
    from locations
    where id = p_location_id
  ),
  'week_revenue_by_day', (
    select coalesce(jsonb_object_agg(t.day, t.revenue), '{}'::jsonb)
    from (
      select to_char(issued_at at time zone 'utc', 'YYYY-MM-DD') as day,
        sum(total) as revenue
      from invoices
      where location_id = p_location_id
        and status = 'paid'
        and issued_at >= p_week_start
        and issued_at <= p_week_end
      group by 1
    ) t
  ),
  'customers_added_per_week', (
    select jsonb_agg(coalesce(b.cnt, 0) order by w.age desc)
    from generate_series(0, 7) as w(age)
    left join (
      select floor(extract(epoch from (p_now - created_at)) / 604800)::int as age,
        count(*) as cnt
      from customers
      where preferred_location_id = p_location_id and created_at >= p_eight_weeks_ago
      group by 1
    ) b on b.age = w.age
  ),
  'vehicles_added_per_week', (
    select jsonb_agg(coalesce(b.cnt, 0) order by w.age desc)
    from generate_series(0, 7) as w(age)
    left join (
      select floor(extract(epoch from (p_now - created_at)) / 604800)::int as age,
        count(*) as cnt
      from vehicles
      where location_id = p_location_id and created_at >= p_eight_weeks_ago
      group by 1
    ) b on b.age = w.age
  ),
  'reminders_per_day', (
    select coalesce(jsonb_agg(coalesce(b.cnt, 0) order by d.idx), '[]'::jsonb)
    from generate_series(
      0,
      greatest(floor(extract(epoch from (p_now - p_month_start)) / 86400)::int, 0)
    ) as d(idx)
    left join (
      select floor(extract(epoch from (sent_at - p_month_start)) / 86400)::int as idx,
        count(*) as cnt
      from reminders
      where location_id = p_location_id and sent_at >= p_month_start
      group by 1
    ) b on b.idx = d.idx
  )
);
$body$;

-- Service-role only: the function takes arbitrary location/user ids, so tenant
-- isolation is the caller's responsibility (mirrors dashboard_stats / revenue_stats).
revoke all on function public.dashboard_stats_v2(uuid, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, date, timestamptz, timestamptz, timestamptz, uuid, boolean, boolean) from public, anon, authenticated;
grant execute on function public.dashboard_stats_v2(uuid, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, date, timestamptz, timestamptz, timestamptz, uuid, boolean, boolean) to service_role;
