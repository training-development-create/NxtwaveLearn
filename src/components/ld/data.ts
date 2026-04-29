// Shared types + small helpers used across the L&D portal.
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
};

export type Lesson = {
  id: string;
  course_id: string;
  title: string;
  duration: number;       // seconds
  position: number;
  video_url: string | null;
  video_path: string | null;
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

// Pass threshold (90% of video runtime) to unlock the assessment
export const UNLOCK_THRESHOLD = 0.9;

// (Avatar placeholders are no longer used — we render initials when avatar_url is empty.)
