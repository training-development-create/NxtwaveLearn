-- =========================================================================
-- HRMS Dynamic Sync — Phase 2
--
-- 1. Add 'exited' to employee_status enum (safe — additive only).
-- 2. Add 'designation' & 'designation_name' columns already synced from
--    Darwinbox (no-ops if bulk_darwin_sync_fields migration ran first).
-- 3. On EXITED: revoke active enrollments + block login via status filter.
-- 4. Function: mark_exited_employees(_synced_since timestamptz)
--    Called by sync job after upsert to mark anyone NOT seen this run as exited.
-- 5. Function: on_employee_exited() trigger — removes pending enrollments
--    when status flips to 'exited' or 'inactive'.
-- 6. Scheduled cron: every 60 minutes via pg_cron (if extension present).
-- =========================================================================

-- -------- 1. Extend enum with 'exited' (idempotent) ---------------------
do $$
begin
  if not exists (
    select 1 from pg_enum
    where enumtypid = 'public.employee_status'::regtype
      and enumlabel = 'exited'
  ) then
    alter type public.employee_status add value 'exited';
  end if;
end $$;

-- -------- 2. designation columns (idempotent) ---------------------------
alter table public.employees
  add column if not exists designation      text,
  add column if not exists designation_name text;

-- -------- 3. mark_exited_employees() ------------------------------------
-- Called at end of every sync run. Any employee whose last_synced_at is
-- OLDER than the sync start timestamp was not returned by Darwinbox this
-- run → they have left the org → mark them exited.
-- Preserves: all lesson_progress, quiz_attempts, historical enrollments.
-- Removes:   only future/active access (via status filter in all queries).
create or replace function public.mark_exited_employees(_synced_before timestamptz)
returns table (exited_count int, exited_emails text[])
language plpgsql
security definer
set search_path = public
as $$
declare
  _ids   uuid[];
  _emails text[];
begin
  -- Find employees whose last_synced_at is before this sync started,
  -- meaning Darwinbox did not return them → they have exited.
  select array_agg(id), array_agg(email)
    into _ids, _emails
    from public.employees
   where status = 'active'
     and (last_synced_at is null or last_synced_at < _synced_before);

  if _ids is null or array_length(_ids, 1) = 0 then
    return query select 0, '{}'::text[];
    return;
  end if;

  -- Mark them exited.
  update public.employees
     set status = 'exited', updated_at = now()
   where id = any(_ids);

  return query select array_length(_ids, 1), _emails;
end $$;

-- -------- 4. Trigger: revoke enrollments when employee exits ------------
-- We do NOT delete progress data. We only remove the enrollment row so
-- the learner can no longer access the course, and they disappear from
-- admin counts. Progress remains for historical analytics.
create or replace function public.on_employee_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- If status flipped to exited or inactive, remove enrollments.
  if new.status in ('exited', 'inactive') and old.status = 'active' then
    if new.auth_user_id is not null then
      delete from public.enrollments
       where user_id = new.auth_user_id;
    end if;
  end if;

  -- If status flipped back to active (re-hire), re-enroll.
  if new.status = 'active' and old.status in ('exited', 'inactive') then
    if new.auth_user_id is not null then
      perform public.refresh_enrollments_for_employee(new.id);
    end if;
  end if;

  return new;
end $$;

drop trigger if exists trg_employee_status_change on public.employees;
create trigger trg_employee_status_change
  after update of status on public.employees
  for each row
  when (old.status is distinct from new.status)
  execute function public.on_employee_status_change();

-- -------- 5. Ensure assigned_employees() excludes exited/inactive -------
-- (Already filters status='active'. Re-create to be safe after enum change.)
create or replace function public.assigned_employees(_course_id uuid)
returns table (employee_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  with rules as (
    select * from public.course_assignments where course_id = _course_id
  )
  select distinct e.id
  from public.employees e
  where e.status = 'active'
    and exists (
      select 1 from rules r
      where r.scope_all = true
         or r.department_id = e.department_id
         or r.sub_department_id = e.sub_department_id
         or r.manager_id = e.manager_id
         or r.employee_id = e.id
    )
$$;

-- -------- 6. refresh_enrollments_for_employee: active-only guard --------
create or replace function public.refresh_enrollments_for_employee(_employee_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.enrollments (user_id, course_id)
  select e.auth_user_id, ca.course_id
  from public.employees e
  join public.course_assignments ca on (
        ca.scope_all
     or ca.department_id = e.department_id
     or ca.sub_department_id = e.sub_department_id
     or ca.manager_id = e.manager_id
     or ca.employee_id = e.id
  )
  where e.id = _employee_id
    and e.auth_user_id is not null
    and e.status = 'active'
  on conflict (user_id, course_id) do nothing;
end $$;

-- -------- 7. Index for faster exited-employee queries -------------------
create index if not exists employees_status_synced_idx
  on public.employees(status, last_synced_at)
  where status = 'active';

-- -------- 8. pg_cron schedule -----------------------------------------
-- Cron is handled by .github/workflows/hrms-sync.yml (runs every hour).
-- If you have pg_cron available, run this manually in SQL Editor:
--
--   select cron.schedule(
--     'hrms-sync-every-60min',
--     '0 * * * *',
--     $cron$ select net.http_post(
--       url     := current_setting('app.supabase_url') || '/functions/v1/sync-employees-daily',
--       headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', current_setting('app.darwin_sync_cron_secret',true)),
--       body    := '{}'::jsonb
--     ) $cron$
--   );
