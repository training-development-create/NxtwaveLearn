-- Roles enum + table (separate from profiles for security)
create type public.app_role as enum ('admin', 'learner');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text not null,
  employee_id text,
  department text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

-- Security definer function to check role (avoids RLS recursion)
create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  )
$$;

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  tag text not null default 'General',
  blurb text not null default '',
  instructor text not null default '',
  hue text not null default '#0072FF',
  emoji text not null default '📘',
  duration_label text not null default '',
  due_in text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null,
  video_url text,
  duration_seconds integer not null default 360,
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index lessons_course_idx on public.lessons(course_id, position);

create table public.mcq_questions (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  question text not null,
  options jsonb not null,
  correct_index integer not null,
  hint text default '',
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index mcq_lesson_idx on public.mcq_questions(lesson_id, position);

create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  enrolled_at timestamptz not null default now(),
  unique (user_id, course_id)
);
create index enrollments_user_idx on public.enrollments(user_id);

create table public.lesson_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  watched_seconds integer not null default 0,
  completed boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (user_id, lesson_id)
);
create index lp_user_idx on public.lesson_progress(user_id);

create table public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  score integer not null,
  total integer not null,
  passed boolean not null,
  answers jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index qa_user_lesson_idx on public.quiz_attempts(user_id, lesson_id);

-- Enable RLS
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.courses enable row level security;
alter table public.lessons enable row level security;
alter table public.mcq_questions enable row level security;
alter table public.enrollments enable row level security;
alter table public.lesson_progress enable row level security;
alter table public.quiz_attempts enable row level security;

-- profiles policies
create policy "Profiles: users see their own" on public.profiles for select to authenticated using (auth.uid() = id);
create policy "Profiles: admins see all" on public.profiles for select to authenticated using (public.has_role(auth.uid(), 'admin'));
create policy "Profiles: users insert own" on public.profiles for insert to authenticated with check (auth.uid() = id);
create policy "Profiles: users update own" on public.profiles for update to authenticated using (auth.uid() = id);

-- user_roles policies
create policy "Roles: users see their own" on public.user_roles for select to authenticated using (auth.uid() = user_id);
create policy "Roles: admins see all" on public.user_roles for select to authenticated using (public.has_role(auth.uid(), 'admin'));
create policy "Roles: admins insert" on public.user_roles for insert to authenticated with check (public.has_role(auth.uid(), 'admin'));
create policy "Roles: admins delete" on public.user_roles for delete to authenticated using (public.has_role(auth.uid(), 'admin'));

-- courses policies
create policy "Courses: any auth read" on public.courses for select to authenticated using (true);
create policy "Courses: admins write" on public.courses for insert to authenticated with check (public.has_role(auth.uid(), 'admin'));
create policy "Courses: admins update" on public.courses for update to authenticated using (public.has_role(auth.uid(), 'admin'));
create policy "Courses: admins delete" on public.courses for delete to authenticated using (public.has_role(auth.uid(), 'admin'));

-- lessons policies
create policy "Lessons: any auth read" on public.lessons for select to authenticated using (true);
create policy "Lessons: admins write" on public.lessons for insert to authenticated with check (public.has_role(auth.uid(), 'admin'));
create policy "Lessons: admins update" on public.lessons for update to authenticated using (public.has_role(auth.uid(), 'admin'));
create policy "Lessons: admins delete" on public.lessons for delete to authenticated using (public.has_role(auth.uid(), 'admin'));

-- mcq_questions policies
create policy "MCQ: any auth read" on public.mcq_questions for select to authenticated using (true);
create policy "MCQ: admins write" on public.mcq_questions for insert to authenticated with check (public.has_role(auth.uid(), 'admin'));
create policy "MCQ: admins update" on public.mcq_questions for update to authenticated using (public.has_role(auth.uid(), 'admin'));
create policy "MCQ: admins delete" on public.mcq_questions for delete to authenticated using (public.has_role(auth.uid(), 'admin'));

-- enrollments policies
create policy "Enroll: users see own" on public.enrollments for select to authenticated using (auth.uid() = user_id);
create policy "Enroll: admins see all" on public.enrollments for select to authenticated using (public.has_role(auth.uid(), 'admin'));
create policy "Enroll: users self-enroll" on public.enrollments for insert to authenticated with check (auth.uid() = user_id);
create policy "Enroll: admins enroll anyone" on public.enrollments for insert to authenticated with check (public.has_role(auth.uid(), 'admin'));
create policy "Enroll: users delete own" on public.enrollments for delete to authenticated using (auth.uid() = user_id);

-- lesson_progress policies
create policy "Progress: users see own" on public.lesson_progress for select to authenticated using (auth.uid() = user_id);
create policy "Progress: admins see all" on public.lesson_progress for select to authenticated using (public.has_role(auth.uid(), 'admin'));
create policy "Progress: users insert own" on public.lesson_progress for insert to authenticated with check (auth.uid() = user_id);
create policy "Progress: users update own" on public.lesson_progress for update to authenticated using (auth.uid() = user_id);

-- quiz_attempts policies
create policy "Attempts: users see own" on public.quiz_attempts for select to authenticated using (auth.uid() = user_id);
create policy "Attempts: admins see all" on public.quiz_attempts for select to authenticated using (public.has_role(auth.uid(), 'admin'));
create policy "Attempts: users insert own" on public.quiz_attempts for insert to authenticated with check (auth.uid() = user_id);

-- Auto-create profile + learner role on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, employee_id, department)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.raw_user_meta_data ->> 'employee_id',
    new.raw_user_meta_data ->> 'department'
  );
  insert into public.user_roles (user_id, role) values (new.id, 'learner');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Update trigger for profiles
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
create trigger courses_touch before update on public.courses for each row execute function public.touch_updated_at();
create trigger progress_touch before update on public.lesson_progress for each row execute function public.touch_updated_at();