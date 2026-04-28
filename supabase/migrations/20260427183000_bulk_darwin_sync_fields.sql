-- Store rich Darwinbox attributes per employee for daily bulk sync.
alter table public.employees
  add column if not exists employee_status text,
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists date_of_joining text,
  add column if not exists date_of_exit text,
  add column if not exists department text,
  add column if not exists department_name text,
  add column if not exists designation text,
  add column if not exists designation_name text,
  add column if not exists direct_manager text,
  add column if not exists direct_manager_email text,
  add column if not exists hod text,
  add column if not exists hod_email_id text,
  add column if not exists l2_manager text,
  add column if not exists l2_manager_email text,
  add column if not exists top_department text,
  add column if not exists company_email_id text,
  add column if not exists date_of_resignation text,
  add column if not exists full_name text,
  add column if not exists personal_mobile_no text,
  add column if not exists office_mobile_no text,
  add column if not exists darwin_raw jsonb;

create index if not exists employees_company_email_idx on public.employees(company_email_id);
create index if not exists employees_direct_manager_email_idx on public.employees(direct_manager_email);
create index if not exists employees_employee_status_idx on public.employees(employee_status);
