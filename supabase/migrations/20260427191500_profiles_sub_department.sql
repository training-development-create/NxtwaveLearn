alter table public.profiles
  add column if not exists sub_department text;

create index if not exists profiles_sub_department_idx on public.profiles(sub_department);
