-- =========================================================================
-- Phase 1 SEED — dummy organization for testing the new schema.
--
-- Adds 4 departments, 7 sub-departments, ~12 employees including 4 managers,
-- and links the very first auth.users row (assumed to be the admin) as an
-- admin employee. Re-running is safe (uses on conflict do nothing).
-- =========================================================================

-- Departments
insert into public.departments (id, name, darwin_id) values
  ('11111111-0000-0000-0000-000000000001','Engineering','dwn-dept-eng'),
  ('11111111-0000-0000-0000-000000000002','Product','dwn-dept-prod'),
  ('11111111-0000-0000-0000-000000000003','Sales','dwn-dept-sales'),
  ('11111111-0000-0000-0000-000000000004','HR','dwn-dept-hr')
on conflict (darwin_id) do nothing;

-- Sub-departments
insert into public.sub_departments (id, name, department_id, darwin_id) values
  ('22222222-0000-0000-0000-000000000001','Backend','11111111-0000-0000-0000-000000000001','dwn-sub-eng-be'),
  ('22222222-0000-0000-0000-000000000002','Frontend','11111111-0000-0000-0000-000000000001','dwn-sub-eng-fe'),
  ('22222222-0000-0000-0000-000000000003','Mobile','11111111-0000-0000-0000-000000000001','dwn-sub-eng-mob'),
  ('22222222-0000-0000-0000-000000000004','Design','11111111-0000-0000-0000-000000000002','dwn-sub-prod-des'),
  ('22222222-0000-0000-0000-000000000005','PM','11111111-0000-0000-0000-000000000002','dwn-sub-prod-pm'),
  ('22222222-0000-0000-0000-000000000006','Inside Sales','11111111-0000-0000-0000-000000000003','dwn-sub-sales-is'),
  ('22222222-0000-0000-0000-000000000007','People Ops','11111111-0000-0000-0000-000000000004','dwn-sub-hr-po')
on conflict (darwin_id) do nothing;

-- Managers (employees with reports). Inserted first so we can reference them.
insert into public.employees (id, name, email, employee_id, department_id, sub_department_id, status, darwin_id) values
  ('33333333-0000-0000-0000-000000000001','Rajesh Kumar','rajesh.kumar+demo@nxtwave.in','NW0001','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001','active','dwn-emp-mgr-1'),
  ('33333333-0000-0000-0000-000000000002','Priya Menon','priya.menon+demo@nxtwave.in','NW0002','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000002','active','dwn-emp-mgr-2'),
  ('33333333-0000-0000-0000-000000000003','Sneha Iyer','sneha.iyer+demo@nxtwave.in','NW0003','11111111-0000-0000-0000-000000000002','22222222-0000-0000-0000-000000000004','active','dwn-emp-mgr-3'),
  ('33333333-0000-0000-0000-000000000004','Anil Kapoor','anil.kapoor+demo@nxtwave.in','NW0004','11111111-0000-0000-0000-000000000003','22222222-0000-0000-0000-000000000006','active','dwn-emp-mgr-4')
on conflict (darwin_id) do nothing;

-- Reports (employees with manager_id set).
insert into public.employees (name, email, employee_id, department_id, sub_department_id, manager_id, status, darwin_id) values
  ('Aarav Sharma','aarav.sharma+demo@nxtwave.in','NW0101','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001','33333333-0000-0000-0000-000000000001','active','dwn-emp-101'),
  ('Vivaan Patel','vivaan.patel+demo@nxtwave.in','NW0102','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001','33333333-0000-0000-0000-000000000001','active','dwn-emp-102'),
  ('Vihaan Gupta','vihaan.gupta+demo@nxtwave.in','NW0103','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000002','33333333-0000-0000-0000-000000000002','active','dwn-emp-103'),
  ('Ishaan Nair','ishaan.nair+demo@nxtwave.in','NW0104','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000002','33333333-0000-0000-0000-000000000002','active','dwn-emp-104'),
  ('Anaya Chopra','anaya.chopra+demo@nxtwave.in','NW0105','11111111-0000-0000-0000-000000000002','22222222-0000-0000-0000-000000000004','33333333-0000-0000-0000-000000000003','active','dwn-emp-105'),
  ('Diya Kapoor','diya.kapoor+demo@nxtwave.in','NW0106','11111111-0000-0000-0000-000000000002','22222222-0000-0000-0000-000000000005','33333333-0000-0000-0000-000000000003','active','dwn-emp-106'),
  ('Kiara Trivedi','kiara.trivedi+demo@nxtwave.in','NW0107','11111111-0000-0000-0000-000000000003','22222222-0000-0000-0000-000000000006','33333333-0000-0000-0000-000000000004','active','dwn-emp-107'),
  ('Tara Bhatia','tara.bhatia+demo@nxtwave.in','NW0108','11111111-0000-0000-0000-000000000003','22222222-0000-0000-0000-000000000006','33333333-0000-0000-0000-000000000004','active','dwn-emp-108')
on conflict (darwin_id) do nothing;

-- Promote whichever auth.users row exists right now to admin (your account).
update public.employees
   set is_admin = true, status = 'active'
 where auth_user_id in (select id from auth.users limit 1);
