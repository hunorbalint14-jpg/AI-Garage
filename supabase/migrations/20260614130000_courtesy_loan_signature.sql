-- Courtesy cars phase 3: capture the customer's drawn signature at check-out.
-- The agreement is already typed-name + version + signed_at; this adds the
-- hand-drawn signature as a PNG in the existing courtesy-car-photos bucket.

alter table public.courtesy_car_loans
  -- Storage object key in the courtesy-car-photos bucket (signatures/ prefix).
  add column if not exists signature_url text;
