-- Supabase advisory (rls_enabled_no_policy, INFO): 24 tables had RLS enabled
-- with zero policies. Deny-all was intentional everywhere, but implicit; this
-- makes it explicit and clears the lint.
--
-- Tenant business tables get real SELECT policies for location members —
-- consistent with the rest of the schema (reminders, job_quotes, …) and a
-- safety net if a route ever reads them with the user-scoped client. WRITES
-- stay service-role-only on purpose: every mutation goes through permission-
-- checked server actions on the admin client, and RLS write policies would
-- bypass those app-level permission gates (e.g. a mechanic's JWT writing
-- invoices over REST).
--
-- Platform/internal tables get the explicit deny-all marker policy
-- (xero_payouts_service_only precedent): still service-role only, but stated.

-- ── Tenant business tables: member read ─────────────────────────────────────

create policy "bays_member_read" on public.bays
  for select to authenticated using (private.is_location_member(location_id));

create policy "bookings_member_read" on public.bookings
  for select to authenticated using (private.is_location_member(location_id));

create policy "fleet_companies_member_read" on public.fleet_companies
  for select to authenticated using (private.is_location_member(location_id));

create policy "invoices_member_read" on public.invoices
  for select to authenticated using (private.is_location_member(location_id));

create policy "jobs_member_read" on public.jobs
  for select to authenticated using (private.is_location_member(location_id));

create policy "job_items_member_read" on public.job_items
  for select to authenticated using (
    exists (
      select 1 from public.jobs j
      where j.id = job_items.job_id
        and private.is_location_member(j.location_id)
    )
  );

create policy "products_member_read" on public.products
  for select to authenticated using (private.is_location_member(location_id));

create policy "scheduled_tasks_member_read" on public.scheduled_tasks
  for select to authenticated using (private.is_location_member(location_id));

create policy "services_member_read" on public.services
  for select to authenticated using (private.is_location_member(location_id));

create policy "tyre_checks_member_read" on public.tyre_checks
  for select to authenticated using (private.is_location_member(location_id));

-- Passkey credentials: a user may read their own rows (public keys +
-- counters only — no secrets); all writes via the admin client.
create policy "webauthn_credentials_select_own" on public.webauthn_credentials
  for select to authenticated using (user_id = (select auth.uid()));

-- ── Platform / internal tables: explicit service-role-only marker ───────────

create policy "alert_rules_service_only" on public.alert_rules
  for all using (false) with check (false);
create policy "cron_runs_service_only" on public.cron_runs
  for all using (false) with check (false);
create policy "data_deletion_log_service_only" on public.data_deletion_log
  for all using (false) with check (false);
create policy "incidents_service_only" on public.incidents
  for all using (false) with check (false);
create policy "incident_updates_service_only" on public.incident_updates
  for all using (false) with check (false);
create policy "mot_delta_runs_service_only" on public.mot_delta_runs
  for all using (false) with check (false);
create policy "password_reset_tokens_service_only" on public.password_reset_tokens
  for all using (false) with check (false);
create policy "sentry_issues_service_only" on public.sentry_issues
  for all using (false) with check (false);
create policy "sentry_snapshot_service_only" on public.sentry_snapshot
  for all using (false) with check (false);
create policy "stripe_webhook_events_service_only" on public.stripe_webhook_events
  for all using (false) with check (false);
create policy "uptime_checks_service_only" on public.uptime_checks
  for all using (false) with check (false);
create policy "uptime_rollup_service_only" on public.uptime_rollup
  for all using (false) with check (false);
create policy "webhook_deliveries_service_only" on public.webhook_deliveries
  for all using (false) with check (false);
