-- Atomic per-location document numbering (#451).
--
-- Invoice / credit-note numbers were derived from a row COUNT at insert time,
-- which (a) races — two concurrent creates mint the same number — and
-- (b) reuses numbers after a draft delete: count drops, the next document
-- takes a number an earlier (possibly sent) document already carries. Invoice
-- numbers are legal identifiers: they must be unique, and deleted drafts may
-- leave gaps but never cause reuse.
--
-- Counter table lives in `private` (not API-exposed); the increment function
-- is SECURITY DEFINER in public so the service-role client can RPC it. It is
-- NOT granted to anon/authenticated.

create table if not exists private.document_counters (
  location_id uuid not null references public.locations(id) on delete cascade,
  kind text not null check (kind in ('invoice', 'credit_note')),
  next_value integer not null,
  primary key (location_id, kind)
);

-- Seed counters past the highest EXISTING number per location so historic
-- numbers are never re-minted (count-based reuse may already have happened;
-- max() absorbs that).
insert into private.document_counters (location_id, kind, next_value)
select location_id, 'invoice',
       coalesce(max(nullif(substring(invoice_number from '(\d+)$'), '')::int), 0) + 1
from public.invoices
group by location_id
on conflict (location_id, kind) do nothing;

insert into private.document_counters (location_id, kind, next_value)
select location_id, 'credit_note',
       coalesce(max(nullif(substring(credit_number from '(\d+)$'), '')::int), 0) + 1
from public.credit_notes
group by location_id
on conflict (location_id, kind) do nothing;

-- Atomic take-a-number. The UPDATE row-locks the counter, so concurrent
-- callers serialise; missing rows are created lazily (new locations).
create or replace function public.next_document_number(p_location_id uuid, p_kind text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v integer;
begin
  if p_kind not in ('invoice', 'credit_note') then
    raise exception 'unknown document kind: %', p_kind;
  end if;
  insert into private.document_counters (location_id, kind, next_value)
  values (p_location_id, p_kind, 1)
  on conflict (location_id, kind) do nothing;
  update private.document_counters
     set next_value = next_value + 1
   where location_id = p_location_id and kind = p_kind
  returning next_value - 1 into v;
  return v;
end;
$$;

revoke execute on function public.next_document_number(uuid, text) from public, anon, authenticated;
grant execute on function public.next_document_number(uuid, text) to service_role;

-- Backstop: numbers must be unique per location forever. Existing duplicates
-- (possible under the old count scheme — only demo/canary data predates this)
-- are suffixed -D2, -D3… keeping the earliest document's number authoritative.
with dupes as (
  select id, row_number() over (partition by location_id, invoice_number order by created_at) as rn
  from public.invoices
)
update public.invoices i
   set invoice_number = i.invoice_number || '-D' || d.rn
  from dupes d
 where d.id = i.id and d.rn > 1;

with dupes as (
  select id, row_number() over (partition by location_id, credit_number order by created_at) as rn
  from public.credit_notes
)
update public.credit_notes c
   set credit_number = c.credit_number || '-D' || d.rn
  from dupes d
 where d.id = c.id and d.rn > 1;

create unique index if not exists invoices_location_invoice_number_key
  on public.invoices (location_id, invoice_number);
create unique index if not exists credit_notes_location_credit_number_key
  on public.credit_notes (location_id, credit_number);
