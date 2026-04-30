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
  // Optional reading material — not gated, purely supplementary.
  reading_material_path: string | null;
  reading_material_name: string | null;
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

// (Avatar placeholders are no longer used — we render initials when avatar_url is empty.)
