-- Compatibility: treat admin from either employees.is_admin (new model)
-- or user_roles.role='admin' (legacy model).
create or replace function public.has_role(_user_id uuid, _role text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when _role = 'admin' then (
      exists (select 1 from public.employees where auth_user_id = _user_id and is_admin)
      or exists (select 1 from public.user_roles where user_id = _user_id and role::text = 'admin')
    )
    when _role = 'learner' then (
      exists (select 1 from public.employees where auth_user_id = _user_id)
      or exists (select 1 from public.user_roles where user_id = _user_id and role::text = 'learner')
    )
    else false
  end
$$;
