-- =========================================================================
-- Phase 1 — Darwin org hierarchy + assignment-based course delivery.
--
-- This migration:
--   1. WIPES existing user/org/progress data (clean slate per the
--      "Wipe everything, start fresh" decision).
--   2. Adds `departments`, `sub_departments` (employees + managers live in
--      a single `employees` table where a manager is just an employee with
--      reports — chosen over a separate `managers` table because it
--      eliminates duplicate rows for player-coach managers).
--   3. Creates `employees` with a self-referencing `manager_id`, a 1:1 link
--      to `auth.users`, and a `status` column for soft-disable.
--   4. Creates `course_assignments` — one row per (course, scope) tuple
--      where scope is exactly one of department / sub_department / manager
--      / employee / 'all'. Combined with the
--      `expand_assignment_to_employees` function, this lets us enforce
--      "auto-enroll new joiners" without snapshotting at publish time.
--   5. Replaces the legacy "auto-enroll all profiles on course publish"
--      trigger with one that respects assignments.
-- =========================================================================

-- -------- 1. Wipe legacy auth + progress data ---------------------------
truncate table public.quiz_attempts, public.lesson_progress, public.enrollments,
              public.notifications, public.user_roles, public.profiles
              restart identity cascade;
delete from auth.users where true;

-- Drop the old auto-enrollment trigger; we replace it below.
drop trigger if exists trg_course_published_ins on public.courses;
drop trigger if exists trg_course_published_upd on public.courses;
drop function if exists public.on_course_published();

-- -------- 2. departments / sub_departments ------------------------------
create table public.departments (
  id uuid primary key default gen_random_uuid(),
  darwin_id text unique,                 -- Darwin's stable identifier
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index departments_name_idx on public.departments(name);

create table public.sub_departments (
  id uuid primary key default gen_random_uuid(),
  darwin_id text unique,
  name text not null,
  department_id uuid not null references public.departments(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sub_departments_dept_idx on public.sub_departments(department_id);

-- -------- 3. employees (managers are employees) -------------------------
create type public.employee_status as enum ('active','inactive','unassigned');

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  darwin_id text unique,
  -- 1:1 link to Supabase auth user. Nullable because Darwin sync can pull
  -- employees who haven't logged in yet.
  auth_user_id uuid unique references auth.users(id) on delete set null,
  email text not null unique,
  name text not null default '',
  employee_id text,                                 -- HR-facing employee code
  contact text,
  department_id uuid references public.departments(id) on delete set null,
  sub_department_id uuid references public.sub_departments(id) on delete set null,
  manager_id uuid references public.employees(id) on delete set null,
  status public.employee_status not null default 'active',
  is_admin boolean not null default false,          -- replaces user_roles for L&D admin flag
  last_synced_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index employees_email_idx on public.employees(email);
create index employees_department_idx on public.employees(department_id);
create index employees_sub_department_idx on public.employees(sub_department_id);
create index employees_manager_idx on public.employees(manager_id);
create index employees_status_idx on public.employees(status);
create index employees_auth_user_idx on public.employees(auth_user_id);
create index employees_employee_id_idx on public.employees(employee_id);

create trigger employees_touch before update on public.employees
  for each row execute function public.touch_updated_at();
create trigger departments_touch before update on public.departments
  for each row execute function public.touch_updated_at();
create trigger sub_departments_touch before update on public.sub_departments
  for each row execute function public.touch_updated_at();

-- -------- 4. course_assignments -----------------------------------------
-- One row per assignment scope. Exactly one of the *_id columns is set
-- (or scope_all=true for "all employees"). The `expand_assignment_to_employees`
-- function below resolves a course's assignment rows into a flat employee
-- list at any point in time, so newly-added employees who match an
-- assignment rule are automatically included.
create table public.course_assignments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  scope_all boolean not null default false,
  department_id uuid references public.departments(id) on delete cascade,
  sub_department_id uuid references public.sub_departments(id) on delete cascade,
  manager_id uuid references public.employees(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete cascade,
  created_at timestamptz not null default now(),
  -- Sanity: exactly one scope target per row.
  constraint chk_one_scope check (
    (case when scope_all       then 1 else 0 end) +
    (case when department_id   is not null then 1 else 0 end) +
    (case when sub_department_id is not null then 1 else 0 end) +
    (case when manager_id      is not null then 1 else 0 end) +
    (case when employee_id     is not null then 1 else 0 end) = 1
  )
);
create index ca_course_idx on public.course_assignments(course_id);
create index ca_dept_idx on public.course_assignments(department_id) where department_id is not null;
create index ca_subdept_idx on public.course_assignments(sub_department_id) where sub_department_id is not null;
create index ca_manager_idx on public.course_assignments(manager_id) where manager_id is not null;
create index ca_employee_idx on public.course_assignments(employee_id) where employee_id is not null;

-- -------- 5. Resolve assignments → employee list ------------------------
-- Used everywhere we need "who is this course assigned to right now":
--   select * from public.assigned_employees(<course_id>)
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

-- -------- 6. New auto-enroll trigger ------------------------------------
-- When a course gets published OR a new assignment is added, materialize
-- enrollments. (Materializing is faster for joins than always going through
-- assigned_employees(), and matches existing analytics queries.)
create or replace function public.refresh_enrollments_for_course(_course_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.enrollments (user_id, course_id)
  select e.auth_user_id, _course_id
  from public.assigned_employees(_course_id) ae
  join public.employees e on e.id = ae.employee_id
  where e.auth_user_id is not null
  on conflict (user_id, course_id) do nothing;
end $$;

create or replace function public.on_assignment_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.refresh_enrollments_for_course(coalesce(new.course_id, old.course_id));
  return new;
end $$;

create trigger trg_assignment_ins after insert on public.course_assignments
  for each row execute function public.on_assignment_change();
create trigger trg_assignment_del after delete on public.course_assignments
  for each row execute function public.on_assignment_change();

-- When an employee gains an auth_user_id (i.e. logs in), backfill their
-- enrollments for every course they're already assigned to.
create or replace function public.refresh_enrollments_for_employee(_employee_id uuid)
returns void language plpgsql security definer set search_path = public as $$
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
  where e.id = _employee_id and e.auth_user_id is not null and e.status = 'active'
  on conflict (user_id, course_id) do nothing;
end $$;

create or replace function public.on_employee_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.auth_user_id is not null and new.status = 'active' then
    perform public.refresh_enrollments_for_employee(new.id);
  end if;
  return new;
end $$;

create trigger trg_employee_change
  after insert or update of auth_user_id, status, department_id, sub_department_id, manager_id
  on public.employees
  for each row execute function public.on_employee_change();

-- -------- 7. Replace handle_new_user ------------------------------------
-- New flow: when an auth.users row is created (OAuth signup), look up the
-- employee by email. If found, link it. If not, create an "unassigned"
-- employee row so the user can still log in and the admin sees them.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  _emp_id uuid;
begin
  -- Try to link an existing employee by email.
  update public.employees
     set auth_user_id = new.id, last_login_at = now()
   where email = new.email and auth_user_id is null
   returning id into _emp_id;

  if _emp_id is null then
    -- Create an unassigned employee row so the user has a profile.
    insert into public.employees (auth_user_id, email, name, status, last_login_at)
    values (
      new.id, new.email,
      coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''),
      'unassigned', now()
    )
    returning id into _emp_id;
  end if;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -------- 8. has_role function rebuilt onto employees.is_admin ----------
create or replace function public.has_role(_user_id uuid, _role text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when _role = 'admin' then exists (select 1 from public.employees where auth_user_id = _user_id and is_admin)
    when _role = 'learner' then exists (select 1 from public.employees where auth_user_id = _user_id)
    else false
  end
$$;

-- -------- 9. RLS on new tables ------------------------------------------
alter table public.departments enable row level security;
alter table public.sub_departments enable row level security;
alter table public.employees enable row level security;
alter table public.course_assignments enable row level security;

-- Read: any authed user can see hierarchy (for filters in admin view).
create policy "departments: authed read" on public.departments
  for select to authenticated using (true);
create policy "sub_departments: authed read" on public.sub_departments
  for select to authenticated using (true);
create policy "employees: self read" on public.employees
  for select to authenticated using (auth_user_id = auth.uid());
create policy "employees: admin read" on public.employees
  for select to authenticated using (public.has_role(auth.uid(), 'admin'));
create policy "course_assignments: admin read" on public.course_assignments
  for select to authenticated using (public.has_role(auth.uid(), 'admin'));
create policy "course_assignments: learner read own" on public.course_assignments
  for select to authenticated using (
    exists (select 1 from public.employees e where e.auth_user_id = auth.uid() and (
      course_assignments.scope_all
      or course_assignments.department_id = e.department_id
      or course_assignments.sub_department_id = e.sub_department_id
      or course_assignments.manager_id = e.manager_id
      or course_assignments.employee_id = e.id
    ))
  );

-- Write: admins only for hierarchy + assignments. Service role bypasses RLS
-- for the Darwin sync edge function.
create policy "departments: admin write" on public.departments
  for all to authenticated using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));
create policy "sub_departments: admin write" on public.sub_departments
  for all to authenticated using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));
create policy "employees: admin write" on public.employees
  for all to authenticated using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));
create policy "course_assignments: admin write" on public.course_assignments
  for all to authenticated using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));
