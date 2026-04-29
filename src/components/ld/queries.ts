// Hooks for fetching the L&D data shapes from Supabase.
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Course, Lesson, MCQItem, CourseWithProgress, LessonProgress } from "./data";

type CourseRow = {
  id: string; title: string; tag: string; blurb: string; instructor: string;
  hue: string; emoji: string; duration_label: string; due_in: string | null;
  agreement_required?: boolean | null;
};

const toCourse = (r: CourseRow): Course => ({
  id: r.id, title: r.title, tag: r.tag, blurb: r.blurb, instructor: r.instructor,
  hue: r.hue, emoji: r.emoji, duration_label: r.duration_label, due_in: r.due_in,
});

function lessonProgressRatio(durationSeconds: number, watchedSeconds: number, completed: boolean): number {
  if (completed) return 1;
  const safeDuration = Math.max(1, Math.round(durationSeconds || 0));
  const safeWatched = Math.max(0, Math.round(watchedSeconds || 0));
  // A lesson/course must not become 100% complete until quiz pass flips `completed=true`.
  return Math.min(0.99, safeWatched / safeDuration);
}

export function useAllCourses() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('courses').select('*').order('created_at', { ascending: true });
    setCourses((data || []).map(toCourse));
    setLoading(false);
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return { courses, loading, reload };
}

export function useUserCourses(userId: string | null) {
  const [items, setItems] = useState<CourseWithProgress[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!userId) { setItems([]); setLoading(false); return; }
    setLoading(true);
    const [{ data: courses }, { data: lessons }, { data: progress }, { data: enrolls }, { data: signedSigs }] = await Promise.all([
      supabase.from('courses').select('*').order('created_at', { ascending: true }),
      supabase.from('lessons').select('id, course_id, duration_seconds'),
      supabase.from('lesson_progress').select('lesson_id, completed, watched_seconds').eq('user_id', userId),
      supabase.from('enrollments').select('course_id').eq('user_id', userId),
      // Compliance: which courses has this user signed the agreement for?
      supabase.from('agreement_signatures').select('course_id').eq('user_id', userId),
    ]);
    const signedCourseIds = new Set(((signedSigs || []) as { course_id: string }[]).map(s => s.course_id));
    const lessonByCourse = new Map<string, { id: string; duration: number }[]>();
    (lessons || []).forEach((l: { id: string; course_id: string; duration_seconds: number }) => {
      const arr = lessonByCourse.get(l.course_id) || [];
      arr.push({ id: l.id, duration: Math.max(1, Math.round(l.duration_seconds || 0)) });
      lessonByCourse.set(l.course_id, arr);
    });
    const progressByLesson = new Map<string, { completed: boolean; watched_seconds: number }>();
    (progress || []).forEach((p: { lesson_id: string; completed: boolean; watched_seconds: number }) => {
      progressByLesson.set(p.lesson_id, p);
    });
    const doneIds = new Set((progress || []).filter((p: { completed: boolean }) => p.completed).map((p: { lesson_id: string }) => p.lesson_id));
    // Any lesson with watched_seconds > 0 means the user has *started* the course,
    // even if they haven't completed/passed it yet.
    const startedIds = new Set((progress || []).filter((p: { watched_seconds: number }) => (p.watched_seconds || 0) > 0).map((p: { lesson_id: string }) => p.lesson_id));
    const enrolledIds = new Set((enrolls || []).map((e: { course_id: string }) => e.course_id));
    const out: CourseWithProgress[] = (courses || []).map((c: CourseRow) => {
      const ids = lessonByCourse.get(c.id) || [];
      const done = ids.filter(l => doneIds.has(l.id)).length;
      const started = ids.some(l => startedIds.has(l.id));
      const total = ids.length;
      const weighted = ids.reduce((sum, l) => {
        const p = progressByLesson.get(l.id);
        return sum + lessonProgressRatio(l.duration, p?.watched_seconds || 0, !!p?.completed);
      }, 0);
      const progressPct = total ? Math.round((weighted / total) * 100) : 0;
      return {
        ...toCourse(c),
        lessons_total: total,
        lessons_done: done,
        progress: progressPct,
        enrolled: enrolledIds.has(c.id),
        started,
        agreement_required: !!c.agreement_required,
        agreement_signed: signedCourseIds.has(c.id),
      };
    });
    setItems(out);
    setLoading(false);
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  // Live updates: refetch when this user's progress / enrollments / quiz attempts change.
  // Debounced so frequent watch-progress saves don't cause refetch storms.
  useEffect(() => {
    if (!userId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => load(), 1500); };
    const ch = supabase
      .channel(`user-courses-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lesson_progress', filter: `user_id=eq.${userId}` }, schedule)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'enrollments', filter: `user_id=eq.${userId}` }, schedule)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quiz_attempts', filter: `user_id=eq.${userId}` }, schedule)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agreement_signatures', filter: `user_id=eq.${userId}` }, schedule)
      .subscribe();
    return () => { if (timer) clearTimeout(timer); supabase.removeChannel(ch); };
  }, [userId, load]);

  return { items, loading, reload: load };
}

export function useCourseLessons(courseId: string | null | undefined, userId: string | null) {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [progress, setProgress] = useState<Record<string, LessonProgress>>({});
  const [attemptsByLesson, setAttemptsByLesson] = useState<Record<string, { passed: boolean; score: number; total: number }[]>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!courseId) { setLessons([]); setLoading(false); return; }
    setLoading(true);
    const { data: ls } = await supabase.from('lessons').select('*').eq('course_id', courseId).order('position', { ascending: true });
    const arr: Lesson[] = (ls || []).map((l: { id: string; course_id: string; title: string; duration_seconds: number; position: number; video_url: string | null; video_path: string | null }) => ({
      id: l.id, course_id: l.course_id, title: l.title, duration: l.duration_seconds, position: l.position, video_url: l.video_url, video_path: l.video_path,
    }));
    setLessons(arr);
    if (userId && arr.length) {
      const ids = arr.map(a => a.id);
      const [{ data: prog }, { data: atts }] = await Promise.all([
        supabase.from('lesson_progress').select('lesson_id, watched_seconds, completed').in('lesson_id', ids).eq('user_id', userId),
        supabase.from('quiz_attempts').select('lesson_id, score, total, passed, created_at').in('lesson_id', ids).eq('user_id', userId).order('created_at', { ascending: true }),
      ]);
      const pmap: Record<string, LessonProgress> = {};
      (prog || []).forEach((p: { lesson_id: string; watched_seconds: number; completed: boolean }) => { pmap[p.lesson_id] = p; });
      setProgress(pmap);
      const amap: Record<string, { passed: boolean; score: number; total: number }[]> = {};
      (atts || []).forEach((a: { lesson_id: string; score: number; total: number; passed: boolean }) => {
        (amap[a.lesson_id] = amap[a.lesson_id] || []).push({ passed: a.passed, score: a.score, total: a.total });
      });
      setAttemptsByLesson(amap);
    }
    setLoading(false);
  }, [courseId, userId]);

  useEffect(() => { load(); }, [load]);

  // Live updates: refetch this course's progress/attempts for the current user.
  // Debounced to avoid causing the Player's <video> to re-render on every save.
  useEffect(() => {
    if (!userId || !courseId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Skip refetches triggered by our own saves within a short window.
    const schedule = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => load(), 2500); };
    const ch = supabase
      .channel(`course-lessons-${courseId}-${userId}`)
      // Only react to quiz attempts in real-time (rare, important for completion flip).
      // Skip lesson_progress because the Player owns that state locally.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quiz_attempts', filter: `user_id=eq.${userId}` }, schedule)
      .subscribe();
    return () => { if (timer) clearTimeout(timer); supabase.removeChannel(ch); };
  }, [courseId, userId, load]);

  return { lessons, progress, attemptsByLesson, loading, reload: load };
}

export function useMCQ(lessonId: string | null | undefined) {
  const [questions, setQuestions] = useState<MCQItem[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!lessonId) { setQuestions([]); setLoading(false); return; }
    setLoading(true);
    supabase.from('mcq_questions').select('*').eq('lesson_id', lessonId).order('position', { ascending: true }).then(({ data }) => {
      setQuestions((data || []).map((m: { id: string; question: string; options: unknown; correct_index: number; hint: string | null }) => ({
        id: m.id, q: m.question, options: m.options as string[], correct: m.correct_index, hint: m.hint || '',
      })));
      setLoading(false);
    });
  }, [lessonId]);
  return { questions, loading };
}

export async function ensureEnrollment(userId: string, courseId: string) {
  await supabase.from('enrollments').upsert({ user_id: userId, course_id: courseId }, { onConflict: 'user_id,course_id' });
}

// Cache the highest watched_seconds per lesson per user so we never persist
// a lower value than what's already saved (resume from highest, not current).
const highestWatchCache = new Map<string, number>();

export async function saveLessonProgress(userId: string, lessonId: string, watched: number, completed: boolean) {
  const key = `${userId}:${lessonId}`;
  let prev = highestWatchCache.get(key);
  if (prev === undefined) {
    const { data } = await supabase.from('lesson_progress')
      .select('watched_seconds').eq('user_id', userId).eq('lesson_id', lessonId).maybeSingle();
    prev = data?.watched_seconds || 0;
  }
  const next = Math.max(prev, Math.round(watched));
  highestWatchCache.set(key, next);
  await supabase.from('lesson_progress').upsert(
    { user_id: userId, lesson_id: lessonId, watched_seconds: next, completed },
    { onConflict: 'user_id,lesson_id' }
  );
}

export async function recordAttempt(userId: string, lessonId: string, answers: number[], score: number, total: number, passed: boolean) {
  await supabase.from('quiz_attempts').insert({ user_id: userId, lesson_id: lessonId, score, total, passed, answers });
}

/** Resolve a signed URL for a video stored in the `course-videos` bucket. */
export async function getVideoUrl(path: string | null) {
  if (!path) return null;
  // Use a longer TTL so 1-hour videos don't expire mid-playback.
  // (Browser caching + signed URL means this does not increase DB load.)
  const { data } = await supabase.storage.from('course-videos').createSignedUrl(path, 60 * 60 * 6);
  return data?.signedUrl ?? null;
}
