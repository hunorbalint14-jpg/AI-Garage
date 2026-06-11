-- Single-round-trip aggregates for the /staff dashboard, replacing 15 parallel
-- PostgREST queries (counts, row fetches, and three raw timestamp lists that
-- were shipped to JS only to be bucketed into sparkline series).
--
-- All date windows are passed in by the caller so the SQL reproduces the
-- page's exact JS semantics (server-local "today", Monday-based week, month
-- start, 60-day due cutoff) instead of re-deriving them in the DB's timezone.
--
-- Series shapes consumed by the page:
--   customers_added_per_week / vehicles_added_per_week:
--     8 counts, oldest week first, bucketed by floor((p_now - created_at)/7d)
--   reminders_per_day:
--     counts per day from p_month_start through the day containing p_now
--   week_revenue_by_day:
--     { "YYYY-MM-DD" (UTC): paid total } for invoices issued in the week

create or replace function public.dashboard_stats(
  p_location_id uuid,
  p_now timestamptz,
  p_today_start timestamptz,
  p_today_end timestamptz,
  p_week_start timestamptz,
  p_week_end timestamptz,
  p_due_cutoff date,
  p_quote_cutoff timestamptz,
  p_month_start timestamptz,
  p_eight_weeks_ago timestamptz
)
returns jsonb
language sql
stable
set search_path = public
as $body$
select jsonb_build_object(
  'total_customers',
    (select count(*) from customers where location_id = p_location_id),
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
    from job_quotes
    where location_id = p_location_id
      and status = 'pending'
      and expires_at <= p_quote_cutoff
  ),
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
      where location_id = p_location_id and created_at >= p_eight_weeks_ago
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

-- Service-role only: the function takes an arbitrary location_id, so tenant
-- isolation is the caller's responsibility (mirrors revenue_stats).
revoke all on function public.dashboard_stats(uuid, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, date, timestamptz, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.dashboard_stats(uuid, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, date, timestamptz, timestamptz, timestamptz) to service_role;
