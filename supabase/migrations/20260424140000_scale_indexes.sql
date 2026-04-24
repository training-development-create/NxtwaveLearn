-- Scale hardening indexes for high-concurrency learner activity.
-- Safe to run multiple times.

CREATE INDEX IF NOT EXISTS lesson_progress_lesson_user_idx
ON public.lesson_progress(lesson_id, user_id);

CREATE INDEX IF NOT EXISTS enrollments_course_user_idx
ON public.enrollments(course_id, user_id);

CREATE INDEX IF NOT EXISTS quiz_attempts_lesson_user_created_idx
ON public.quiz_attempts(lesson_id, user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS lesson_progress_user_updated_idx
ON public.lesson_progress(user_id, updated_at DESC);
