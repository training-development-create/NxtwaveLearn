// Hooks for fetching the Compliance Training data shapes from Supabase.
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Course, Lesson, MCQItem, CourseWithProgress, LessonProgress } from "./data";

type CourseRow = {
  id: string; title: string; tag: string; blurb: string; instructor: string;
  hue: string; emoji: string; duration_label: string; due_in: string | null;
  agreement_required?: boolean | null;
  // Optional new fields. May not exist in older Supabase projects — readers
  // tolerate undefined.
  due_in_days?: number | null;
  published_at?: string | null;
};

// Computes the human "due in X days / overdue" label from the per-course
// due_in_days + published_at. Falls back to the legacy free-text due_in
// column if the new fields aren't set.
function computeDueLabel(r: CourseRow): string | null {
  if (r.due_in_days && r.published_at) {
    const publishedMs = Date.parse(r.published_at);
    if (!isNaN(publishedMs)) {
      const dueMs = publishedMs + r.due_in_days * 24 * 60 * 60 * 1000;
      const remainingMs = dueMs - Date.now();
      const days = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
      if (days < 0) return `Overdue by ${Math.abs(days)}d`;
      if (days === 0) return 'Due today';
      if (days === 1) return 'Due tomorrow';
      return `Due in ${days}d`;
    }
  }
  return r.due_in ?? null;
}

// Absolute ISO due-date, computed from published_at + due_in_days. Surfaced
// alongside the relative `due_in` label so the Player + admin analytics can
// show "Due by 12 May 2026" while Dashboard cards keep the short label.
function computeDueAt(r: CourseRow): string | null {
  if (!r.due_in_days || !r.published_at) return null;
  const publishedMs = Date.parse(r.published_at);
  if (isNaN(publishedMs)) return null;
  return new Date(publishedMs + r.due_in_days * 24 * 60 * 60 * 1000).toISOString();
}

const toCourse = (r: CourseRow): Course => ({
  id: r.id, title: r.title, tag: r.tag, blurb: r.blurb, instructor: r.instructor,
  hue: r.hue, emoji: r.emoji, duration_label: r.duration_label,
  due_in: computeDueLabel(r),
  published_at: r.published_at ?? null,
  due_at: computeDueAt(r),
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
    // Two-phase fetch: first load courses + this user's enrollments,
    // THEN load only the lessons that belong to their enrolled courses.
    // At scale (50+ courses × 20 lessons globally) this avoids dragging
    // the entire lessons table to every user on every page load.
    const [{ data: courses }, { data: enrolls }, { data: progress }, { data: signedSigs }] = await Promise.all([
      supabase.from('courses').select('*').order('created_at', { ascending: true }),
      supabase.from('enrollments').select('course_id').eq('user_id', userId),
      supabase.from('lesson_progress').select('lesson_id, completed, watched_seconds').eq('user_id', userId),
      // Compliance: which courses has this user signed the agreement for?
      supabase.from('agreement_signatures').select('course_id').eq('user_id', userId),
    ]);
    const enrolledCourseIds = (enrolls || []).map((e: { course_id: string }) => e.course_id);
    const lessonsQuery = enrolledCourseIds.length
      ? supabase.from('lessons').select('id, course_id, duration_seconds').in('course_id', enrolledCourseIds)
      : Promise.resolve({ data: [] as { id: string; course_id: string; duration_seconds: number }[] });
    const { data: lessons } = await lessonsQuery;
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
      const rawPct = total ? Math.round((weighted / total) * 100) : 0;
      // Strict 3-state course completion gate. A course is only "100%"
      // when every lesson is completed AND (when required) the agreement
      // is signed. If the agreement is still missing we cap progress at
      // 99% so the user portal status stays "In progress" — never flips
      // to "Completed" prematurely. This keeps the user-portal status,
      // the manager dashboard, and the admin analytics in lockstep.
      const agreementRequired = !!c.agreement_required;
      const agreementSigned = signedCourseIds.has(c.id);
      const agreementOk = !agreementRequired || agreementSigned;
      const allLessonsDone = total > 0 && done === total;
      const fullyComplete = allLessonsDone && agreementOk;
      const progressPct = fullyComplete ? 100 : Math.min(99, rawPct);
      return {
        ...toCourse(c),
        lessons_total: total,
        lessons_done: done,
        progress: progressPct,
        enrolled: enrolledIds.has(c.id),
        started,
        agreement_required: agreementRequired,
        agreement_signed: agreementSigned,
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
  // When true, the current user is not enrolled in this course AND has no
  // assignment scope match. The Player should refuse to render the video.
  const [accessDenied, setAccessDenied] = useState(false);

  const load = useCallback(async () => {
    if (!courseId) { setLessons([]); setLoading(false); setAccessDenied(false); return; }
    setLoading(true);
    setAccessDenied(false);
    // Strict access gate — a learner can only load lesson data for a course
    // they are enrolled in. We deliberately check this BEFORE fetching the
    // lessons themselves so a user who manipulates the URL with a courseId
    // they were never assigned cannot pull video lists or signed URLs.
    // Admins (no userId in this hook because they don't watch as learners)
    // bypass via the AdminAnalytics component which doesn't use this hook.
    if (userId) {
      const { data: enrolled } = await supabase
        .from('enrollments')
        .select('course_id')
        .eq('user_id', userId)
        .eq('course_id', courseId)
        .maybeSingle();
      if (!enrolled) {
        setLessons([]);
        setProgress({});
        setAttemptsByLesson({});
        setAccessDenied(true);
        setLoading(false);
        return;
      }
    }
    const { data: ls } = await supabase.from('lessons').select('*').eq('course_id', courseId).order('position', { ascending: true });
    const arr: Lesson[] = (ls || []).map((l: { id: string; course_id: string; title: string; duration_seconds: number; position: number; video_url: string | null; video_path: string | null; reading_material_path?: string | null; reading_material_name?: string | null }) => ({
      id: l.id, course_id: l.course_id, title: l.title, duration: l.duration_seconds, position: l.position, video_url: l.video_url, video_path: l.video_path,
      reading_material_path: l.reading_material_path ?? null,
      reading_material_name: l.reading_material_name ?? null,
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

  return { lessons, progress, attemptsByLesson, loading, accessDenied, reload: load };
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

// Strict enrollment guard. The old behaviour was a blind upsert — anyone with
// a courseId could bookmark a Player URL and grant themselves access. Now we
// only confirm an existing enrollment row (the admin's publish flow is the
// sole writer for new enrollment rows). Returns whether the user is enrolled.
export async function ensureEnrollment(userId: string, courseId: string): Promise<boolean> {
  const { data } = await supabase
    .from('enrollments')
    .select('course_id')
    .eq('user_id', userId)
    .eq('course_id', courseId)
    .maybeSingle();
  return !!data;
}

// Cache the highest watched_seconds per lesson per user so we never persist
// a lower value than what's already saved (resume from highest, not current).
const highestWatchCache = new Map<string, number>();
// In-flight write coalescing: while a save is pending for a (user,lesson),
// any new caller awaits the same Promise. After it resolves we coalesce the
// "next" pending value so we never have more than one in-flight + one queued
// write per learner. Critical at scale — without this the 8s interval can
// stack writes during slow networks and exhaust DB connections.
const inFlight = new Map<string, Promise<void>>();
const pending = new Map<string, { watched: number; completed: boolean }>();

async function flushSave(userId: string, lessonId: string, key: string) {
  // Drain whatever the latest pending value is for this key.
  const job = pending.get(key);
  if (!job) { inFlight.delete(key); return; }
  pending.delete(key);
  let prev = highestWatchCache.get(key);
  if (prev === undefined) {
    const { data } = await supabase.from('lesson_progress')
      .select('watched_seconds').eq('user_id', userId).eq('lesson_id', lessonId).maybeSingle();
    prev = data?.watched_seconds || 0;
  }
  const next = Math.max(prev, Math.round(job.watched));
  highestWatchCache.set(key, next);
  await supabase.from('lesson_progress').upsert(
    { user_id: userId, lesson_id: lessonId, watched_seconds: next, completed: job.completed },
    { onConflict: 'user_id,lesson_id' }
  );
  // If more saves were queued while we were writing, drain them on the next tick.
  if (pending.has(key)) {
    inFlight.set(key, flushSave(userId, lessonId, key));
  } else {
    inFlight.delete(key);
  }
}

export async function saveLessonProgress(userId: string, lessonId: string, watched: number, completed: boolean) {
  const key = `${userId}:${lessonId}`;
  // Coalesce: if a save is in flight, just record the latest desired state.
  // The flushSave loop will pick it up after the current write completes.
  const prevPending = pending.get(key);
  pending.set(key, {
    watched: Math.max(prevPending?.watched ?? 0, watched),
    completed: prevPending?.completed || completed,
  });
  if (inFlight.has(key)) return inFlight.get(key);
  const p = flushSave(userId, lessonId, key);
  inFlight.set(key, p);
  return p;
}

export async function recordAttempt(userId: string, lessonId: string, answers: number[], score: number, total: number, passed: boolean) {
  await supabase.from('quiz_attempts').insert({ user_id: userId, lesson_id: lessonId, score, total, passed, answers });
}

// Memoise signed URLs per page lifetime — switching back to a previous lesson
// shouldn't re-hit Supabase storage. Entry expires 30 minutes before the
// signed URL itself so we never serve a URL about to die mid-playback.
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 6;
const SIGNED_URL_CACHE_MS = (SIGNED_URL_TTL_SECONDS - 30 * 60) * 1000;
const signedUrlCache = new Map<string, { url: string; at: number }>();

/** Resolve a signed URL for a video stored in the `course-videos` bucket. */
export async function getVideoUrl(path: string | null) {
  if (!path) return null;
  const cached = signedUrlCache.get(path);
  if (cached && Date.now() - cached.at < SIGNED_URL_CACHE_MS) return cached.url;
  // Use a longer TTL so 1-hour videos don't expire mid-playback.
  // (Browser caching + signed URL means this does not increase DB load.)
  const { data } = await supabase.storage.from('course-videos').createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  const url = data?.signedUrl ?? null;
  if (url) signedUrlCache.set(path, { url, at: Date.now() });
  return url;
}

// Reading material lives in a public bucket — supplementary, not gated.
export function getReadingMaterialUrl(path: string | null) {
  if (!path) return null;
  const { data } = supabase.storage.from('reading-materials').getPublicUrl(path);
  return data?.publicUrl ?? null;
}
