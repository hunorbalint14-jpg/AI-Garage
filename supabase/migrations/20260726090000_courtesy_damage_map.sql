-- Damage markers for courtesy-car loans.
--
-- UK hire practice is a diagram marked at hand-over and marked again at return,
-- so the two states can be diffed in a dispute. That mirrors the existing
-- condition_out / condition_in free-text pair, so the markers live alongside
-- them on the loan rather than in a table of their own — they are only ever
-- read and written as one whole set with their loan, never queried across.
--
-- Shape (validated in the app, see src/lib/courtesy-damage.ts):
--   [{ "id": "m1", "view": "front"|"rear"|"nearside"|"offside"|"wheels",
--      "x": 0..100, "y": 0..100,          -- % of the view box
--      "code": "S"|"D"|"C"|"CR"|"SF"|"M"|"R",
--      "size": "S"|"M"|"L",               -- <=50mm / 50-200mm / >200mm
--      "note": "optional free text" }]

alter table public.courtesy_car_loans
  add column if not exists damage_out jsonb not null default '[]'::jsonb,
  add column if not exists damage_in  jsonb not null default '[]'::jsonb;

-- Reject anything that is not a JSON array, so a malformed write can never
-- make the diagram unrenderable for the loan it belongs to.
alter table public.courtesy_car_loans
  drop constraint if exists courtesy_car_loans_damage_out_is_array;
alter table public.courtesy_car_loans
  add constraint courtesy_car_loans_damage_out_is_array
  check (jsonb_typeof(damage_out) = 'array');

alter table public.courtesy_car_loans
  drop constraint if exists courtesy_car_loans_damage_in_is_array;
alter table public.courtesy_car_loans
  add constraint courtesy_car_loans_damage_in_is_array
  check (jsonb_typeof(damage_in) = 'array');

comment on column public.courtesy_car_loans.damage_out is
  'Damage markers recorded at check-out. Array of {id,view,x,y,code,size,note}.';
comment on column public.courtesy_car_loans.damage_in is
  'Damage markers recorded at return, seeded from damage_out so new damage is additive.';
