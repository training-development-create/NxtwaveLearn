-- =========================================================================
-- Quiz attempt-level analytics + first-attempt signals/feedback.
--
-- Extends the existing quiz_attempts (keyed by lesson_id) with attempt-level
-- fields, and adds quiz_question_responses for per-question analytics
-- (selected answer, correctness, "unclear"/"not confident" signals).
--
--   • Every submit already inserts a NEW quiz_attempts row → full history kept.
--   • Per-question responses are written once per attempt.
--   • Signals + feedback are captured on the FIRST attempt only (enforced in
--     the app); the columns simply stay NULL/false for retakes.
-- =========================================================================

-- -------- 1. Attempt-level columns --------------------------------------
alter table public.quiz_attempts
  add column if not exists attempt_number    integer,
  add column if not exists started_at        timestamptz,
  add column if not exists submitted_at       timestamptz default now(),
  add column if not exists overall_rating     integer,        -- 1..5, NULL if skipped
  add column if not exists overall_feedback   text,           -- open text, NULL if skipped
  add column if not exists feedback_submitted boolean not null default false,
  add column if not exists is_first_attempt   boolean not null default false;

-- -------- 2. Per-question response analytics ----------------------------
create table if not exists public.quiz_question_responses (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.quiz_attempts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  question_id uuid not null references public.mcq_questions(id) on delete cascade,
  position integer not null default 0,         -- question order (Q1, Q2, …) for the export
  selected_answer integer,                      -- index the learner chose (null = unanswered)
  correct_answer integer,                       -- the correct index at attempt time
  is_correct boolean,
  unclear_question_flag boolean not null default false,  -- "this question wasn't clear"
  not_confident_flag    boolean not null default false,  -- "I'm not confident about this concept"
  answered_at timestamptz not null default now()
);
create index if not exists qqr_attempt_idx  on public.quiz_question_responses(attempt_id);
create index if not exists qqr_question_idx on public.quiz_question_responses(question_id);
create index if not exists qqr_user_idx     on public.quiz_question_responses(user_id);

-- -------- 3. RLS — learners write/read own; admins read all -------------
alter table public.quiz_question_responses enable row level security;
create policy "qqr: users insert own" on public.quiz_question_responses
  for insert to authenticated with check (auth.uid() = user_id);
create policy "qqr: users see own" on public.quiz_question_responses
  for select to authenticated using (auth.uid() = user_id);
create policy "qqr: admins see all" on public.quiz_question_responses
  for select to authenticated using (public.has_role(auth.uid(), 'admin'));
