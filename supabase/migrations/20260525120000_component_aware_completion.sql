-- =========================================================================
-- Component-aware completion re-evaluation.
--
-- Historically `lesson_progress.completed` was set to TRUE the moment a
-- learner finished the video — regardless of whether the lesson also had a
-- quiz that still needed a passing attempt. It was ALSO forced to FALSE while
-- a course-level agreement was unsigned (e-sign is a course gate, not a
-- per-lesson one). Both made the admin "Completed" counts wrong.
--
-- New rule for the per-lesson flag (e-sign is applied separately, at the
-- course level, by the app's completion calc):
--
--     completed = (no video OR watched in full)
--             AND (no quiz  OR at least one passing attempt)
--
-- This migration recomputes the flag for all existing rows so historical data
-- matches the new application logic. It is idempotent — safe to re-run.
-- =========================================================================

-- 1. DEMOTE: a lesson that HAS a quiz but has NO passing attempt for this user
--    is not actually complete, even if the video was watched to the end.
update public.lesson_progress lp
set completed = false
where lp.completed = true
  and exists (
    select 1 from public.mcq_questions m
    where m.lesson_id = lp.lesson_id
  )
  and not exists (
    select 1 from public.quiz_attempts qa
    where qa.lesson_id = lp.lesson_id
      and qa.user_id = lp.user_id
      and qa.passed = true
  );

-- 2. PROMOTE: a lesson whose components are ALL satisfied but that was left
--    incomplete (e.g. demoted by the old "false until the agreement is signed"
--    behaviour) is now complete.
--      • quiz satisfied  : lesson has no quiz OR a passing attempt exists
--      • video satisfied : lesson has no runtime (no video) OR watched in full
update public.lesson_progress lp
set completed = true
where lp.completed = false
  and (
    not exists (
      select 1 from public.mcq_questions m
      where m.lesson_id = lp.lesson_id
    )
    or exists (
      select 1 from public.quiz_attempts qa
      where qa.lesson_id = lp.lesson_id
        and qa.user_id = lp.user_id
        and qa.passed = true
    )
  )
  and exists (
    select 1 from public.lessons l
    where l.id = lp.lesson_id
      and (coalesce(l.duration_seconds, 0) = 0 or lp.watched_seconds >= l.duration_seconds)
  );
