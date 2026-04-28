-- Darwin HR sync fields + analytics indexes.
--
-- Adds the manager / department fields populated by the sync-employee edge
-- function (which calls the Darwin HR API on first login). Adds indexes
-- required by the manager- and department-grouped admin analytics queries.

alter table public.profiles
  add column if not exists department text,
  add column if not exists manager_name text,
  add column if not exists manager_email text,
  add column if not exists manager_contact text,
  add column if not exists darwin_synced_at timestamptz;

create index if not exists profiles_department_idx on public.profiles(department);
create index if not exists profiles_manager_email_idx on public.profiles(manager_email);
create index if not exists profiles_manager_name_idx on public.profiles(manager_name);
create index if not exists profiles_employee_id_idx on public.profiles(employee_id);

-- Extend the auto-create trigger so OAuth signups can carry through any
-- manager / department fields stored in user metadata. Existing rows are
-- backfilled by the sync-employee edge function.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    id, email, full_name, employee_id, department,
    manager_name, manager_email, manager_contact
  )
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''),
    new.raw_user_meta_data ->> 'employee_id',
    new.raw_user_meta_data ->> 'department',
    new.raw_user_meta_data ->> 'manager_name',
    new.raw_user_meta_data ->> 'manager_email',
    new.raw_user_meta_data ->> 'manager_contact'
  )
  on conflict (id) do nothing;
  insert into public.user_roles (user_id, role)
    values (new.id, 'learner')
    on conflict (user_id, role) do nothing;
  return new;
end;
$$;
