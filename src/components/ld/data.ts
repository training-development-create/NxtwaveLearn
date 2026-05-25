// Shared types + small helpers used across the Compliance Training Portal.
// All real data is loaded from Supabase. This file only holds types & utilities.

export type Course = {
  id: string;
  title: string;
  tag: string;
  hue: string;
  emoji: string;
  instructor: string;
  blurb: string;
  duration_label: string;
  due_in: string | null;
  // ISO timestamps. published_at is set by Admin → Upload at Publish time.
  // due_at is computed from published_at + due_in_days (admin-configured).
  // Both are nullable so older rows that never had them still render.
  published_at: string | null;
  due_at: string | null;
};

export type Lesson = {
  id: string;
  course_id: string;
  title: string;
  duration: number;       // seconds
  position: number;
  video_url: string | null;
  video_path: string | null;
  // Whether this lesson has at least one MCQ question attached. Drives the
  // component-aware completion gate: a lesson with no quiz must not require a
  // passing attempt to be considered done.
  has_quiz: boolean;
  // Optional reading material — not gated, purely supplementary.
  reading_material_path: string | null;
  reading_material_name: string | null;
  // Optional assessment file — the raw assessment document for learner reference.
  assessment_file_path: string | null;
  assessment_file_name: string | null;
};

export type LessonProgress = {
  lesson_id: string;
  watched_seconds: number;
  completed: boolean;
};

export type MCQItem = {
  id: string;
  q: string;
  options: string[];
  correct: number;
  hint: string;
};

export type CourseWithProgress = Course & {
  lessons_total: number;
  lessons_done: number;
  progress: number; // 0..100
  enrolled: boolean;
  started: boolean; // user has watched at least some of any lesson in this course
  // Compliance — agreement signing
  agreement_required: boolean;
  agreement_signed: boolean;
};

export const fmt = (s: number) => `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;

// Short, locale-friendly date used across the Player, Dashboard, and Admin
// Analytics so Published/Due dates render identically everywhere. Returns
// "—" when the input is missing/unparseable so callers don't have to branch.
export const fmtShortDate = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (isNaN(t)) return '—';
  return new Date(t).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
};

// Pass threshold (100% of video runtime) to unlock the assessment.
// Compliance requires the learner to watch the full video before they can attempt the assessment.
export const UNLOCK_THRESHOLD = 1.0;

// A lesson "has a video" iff it has a non-zero runtime. The upload flow sets
// duration_seconds=0 exactly when no video file was attached (Player handles
// DUR=0 gracefully), so runtime is a reliable, query-cheap proxy for video
// presence everywhere — no need to fetch video_path in every analytics query.
export const lessonHasVideo = (durationSeconds: number | null | undefined): boolean =>
  (durationSeconds ?? 0) > 0;

// Component-aware lesson completion. A lesson counts as done only when EVERY
// component it actually has is satisfied:
//   • video → watched to (UNLOCK_THRESHOLD × runtime)
//   • quiz  → at least one passing attempt (100%)
// Components the lesson lacks are treated as already-satisfied. E-sign is a
// course-level gate applied separately, not part of per-lesson completion.
export function isLessonComplete(opts: {
  hasVideo: boolean;
  hasQuiz: boolean;
  watchedSeconds: number;
  durationSeconds: number;
  quizPassed: boolean;
}): boolean {
  const videoOk = !opts.hasVideo
    || (opts.durationSeconds > 0 ? opts.watchedSeconds >= opts.durationSeconds * UNLOCK_THRESHOLD : true);
  const quizOk = !opts.hasQuiz || opts.quizPassed;
  return videoOk && quizOk;
}

// (Avatar placeholders are no longer used — we render initials when avatar_url is empty.)
