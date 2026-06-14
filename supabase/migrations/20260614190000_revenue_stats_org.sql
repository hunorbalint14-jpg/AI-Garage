-- Org-wide revenue aggregates for /staff/revenue's "All locations" view.
-- Mirrors revenue_stats(p_location_id) (20260610100000_revenue_stats.sql) exactly
-- but sums across every branch in the org via invoices.organization_id (added in
-- the expand migration). Owner/admin/accountant get org-wide totals; the
-- per-branch view still calls revenue_stats(p_location_id).

create or replace function public.revenue_stats_org(p_organization_id uuid)
returns table (
  revenue_this_month numeric,
  revenue_ytd numeric,
  total_paid numeric,
  paid_count bigint,
  outstanding numeric,
  overdue numeric,
  monthly_revenue jsonb
)
language sql
stable
set search_path = public
as $body$
  with inv as (
    select total, status, due_at, paid_at
    from invoices
    where organization_id = p_organization_id
  ),
  months as (
    select generate_series(
      date_trunc('month', now()) - interval '5 months',
      date_trunc('month', now()),
      interval '1 month'
    ) as month_start
  ),
  paid_by_month as (
    select date_trunc('month', paid_at) as month_start, sum(total) as revenue
    from inv
    where status = 'paid'
      and paid_at >= date_trunc('month', now()) - interval '5 months'
    group by 1
  )
  select
    coalesce(sum(total) filter (where status = 'paid' and paid_at >= date_trunc('month', now())), 0),
    coalesce(sum(total) filter (where status = 'paid' and paid_at >= date_trunc('year', now())), 0),
    coalesce(sum(total) filter (where status = 'paid'), 0),
    count(*) filter (where status = 'paid'),
    coalesce(sum(total) filter (where status = 'sent' or (status <> 'paid' and due_at >= now())), 0),
    coalesce(sum(total) filter (where status not in ('paid', 'draft') and due_at < now()), 0),
    (
      select coalesce(
        jsonb_agg(jsonb_build_object(
          'month_start', to_char(m.month_start, 'YYYY-MM-DD'),
          'revenue', coalesce(p.revenue, 0)
        ) order by m.month_start),
        '[]'::jsonb
      )
      from months m
      left join paid_by_month p using (month_start)
    )
  from inv;
$body$;

-- Service-role only: takes an arbitrary organization_id, so tenant isolation is
-- the caller's responsibility (mirrors revenue_stats).
revoke all on function public.revenue_stats_org(uuid) from public, anon, authenticated;
grant execute on function public.revenue_stats_org(uuid) to service_role;
