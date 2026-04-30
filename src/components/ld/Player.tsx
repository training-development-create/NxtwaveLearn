import { useState, useEffect, useRef } from "react";
import { useCourseLessons, saveLessonProgress, getVideoUrl, getReadingMaterialUrl } from "./queries";
import { useAuth } from "./auth";
import { supabase } from "@/integrations/supabase/client";
import { Btn, Card, ProgressBar, Icon, EmptyState } from "./ui";
import { fmt, UNLOCK_THRESHOLD } from "./data";
import type { Nav, AppState } from "./App";

const lessonRatio = (duration: number, watched: number, completed: boolean) => {
  if (completed) return 1;
  const safeDuration = Math.max(1, duration || 0);
  const safeWatched = Math.max(0, watched || 0);
  return Math.min(1, safeWatched / safeDuration);
};

export function Player({ onNav, state, setState }: { onNav: Nav; state: AppState; setState: (s: AppState) => void }) {
  const { user } = useAuth();
  const courseId = state.course;
  const [course, setCourse] = useState<{ id: string; title: string; instructor: string; emoji: string; duration_label: string; agreement_required: boolean; agreement_pdf_path: string | null } | null>(null);
  const { lessons, progress, attemptsByLesson, loading, accessDenied, reload } = useCourseLessons(courseId, user?.id ?? null);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [hasSignedAgreement, setHasSignedAgreement] = useState(false);
  const [showComplianceModal, setShowComplianceModal] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!courseId) return;
    supabase.from('courses').select('id, title, instructor, emoji, duration_label, agreement_required, agreement_pdf_path').eq('id', courseId).maybeSingle()
      .then(({ data }) => setCourse(data));
  }, [courseId]);

  // One-time compliance notice per (user, course). Stored in localStorage so
  // we don't nag returning learners. The wizard still appears the first time
  // a user opens any new course they're enrolled in.
  useEffect(() => {
    if (!courseId || !user) return;
    const key = `compliance-ack-${user.id}-${courseId}`;
    if (typeof window !== 'undefined' && !window.localStorage.getItem(key)) {
      setShowComplianceModal(true);
    }
  }, [courseId, user]);

  // Has the user signed this course's agreement (if any)?
  // Refetch on tab focus / visibility so returning from the agreement-sign
  // view updates the unlocked state without a manual page refresh.
  // RATE-LIMITED: at scale, naive refetch on every tab visibility/focus
  // event creates a thundering herd against Supabase whenever many learners
  // tab-switch in unison. We dedupe to at most one fetch per 30s.
  useEffect(() => {
    if (!user || !courseId) { setHasSignedAgreement(false); return; }
    let cancelled = false;
    let lastFetchAt = 0;
    const REFRESH_COOLDOWN_MS = 30_000;
    const fetchSig = () => {
      supabase.from('agreement_signatures').select('id').eq('user_id', user.id).eq('course_id', courseId).maybeSingle()
        .then(({ data }) => { if (!cancelled) setHasSignedAgreement(!!data); });
    };
    fetchSig();
    lastFetchAt = Date.now();
    const maybeRefresh = () => {
      if (Date.now() - lastFetchAt < REFRESH_COOLDOWN_MS) return;
      lastFetchAt = Date.now();
      fetchSig();
      reload();
    };
    const onVisible = () => { if (!document.hidden) maybeRefresh(); };
    const onFocus = () => { maybeRefresh(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
    };
  }, [user, courseId, reload]);

  const acknowledgeCompliance = () => {
    if (user && courseId && typeof window !== 'undefined') {
      window.localStorage.setItem(`compliance-ack-${user.id}-${courseId}`, '1');
    }
    setShowComplianceModal(false);
  };

  const locks = lessons.map((_, idx) => {
    if (idx === 0) return false;
    for (let i = 0; i < idx; i++) {
      const l = lessons[i];
      const p = progress[l.id];
      const passedAny = (attemptsByLesson[l.id] || []).some(a => a.passed);
      if (!p?.completed || !passedAny) return true;
    }
    return false;
  });

  const firstUnlocked = lessons.findIndex((_, i) => !locks[i] && !progress[lessons[i].id]?.completed);
  const initialId = state.activeLesson || (firstUnlocked >= 0 ? lessons[firstUnlocked]?.id : lessons[0]?.id);
  const [activeId, setActiveId] = useState<string | undefined>(initialId);

  useEffect(() => {
    if (!activeId && lessons.length) setActiveId(initialId);
  }, [lessons, activeId, initialId]);

  const lesson = lessons.find(l => l.id === activeId);
  const lessonIdx = lessons.findIndex(l => l.id === activeId);

  // Resolve signed URL when lesson changes
  useEffect(() => {
    if (!lesson?.video_path) { setVideoSrc(null); return; }
    getVideoUrl(lesson.video_path).then(url => setVideoSrc(url));
  }, [lesson?.id, lesson?.video_path]);

  const DUR = lesson?.duration ?? 0;
  const savedWatched = lesson ? (progress[lesson.id]?.watched_seconds ?? 0) : 0;
  const [t, setT] = useState(0);
  const [furthest, setFurthest] = useState(0);
  const [showNote, setShowNote] = useState<string | null>(null);
  const [paused, setPaused] = useState(true);
  const lastSaveRef = useRef(0);
  const furthestRef = useRef(0);
  const completedRef = useRef(false);
  // Snapshot the resume position once per lesson so the <video> doesn't
  // re-seek (and visibly "shake") every time progress refetches.
  const resumeAtRef = useRef(0);

  useEffect(() => {
    if (!lesson) return;
    const start = Math.min(savedWatched, lesson.duration);
    setT(start);
    setFurthest(start);
    furthestRef.current = start;
    resumeAtRef.current = start;
    completedRef.current = !!progress[lesson.id]?.completed;
  // Intentionally only reset on lesson switch — not on every progress refetch.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // Keep completedRef in sync without retriggering effects.
  useEffect(() => {
    if (lesson) completedRef.current = !!progress[lesson.id]?.completed;
  }, [progress, lesson]);

  // Resume in <video> when src is ready (use snapshot, not live savedWatched).
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !videoSrc) return;
    const target = resumeAtRef.current;
    if (target <= 0) return;
    const onLoaded = () => { v.currentTime = Math.min(target, (v.duration || target)); };
    v.addEventListener('loadedmetadata', onLoaded, { once: true });
    return () => v.removeEventListener('loadedmetadata', onLoaded);
  }, [videoSrc]);

  // Force playback rate to 1x — speed switching is intentionally disabled
  // for compliance training. Even if the user opens browser dev tools, we
  // re-pin it on every play / rate change event.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = 1;
    const pin = () => { if (v.playbackRate !== 1) v.playbackRate = 1; };
    v.addEventListener('ratechange', pin);
    v.addEventListener('play', pin);
    return () => {
      v.removeEventListener('ratechange', pin);
      v.removeEventListener('play', pin);
    };
  }, [videoSrc]);

  // If progress row arrives slightly later, align resume position once.
  useEffect(() => {
    if (!lesson) return;
    if (savedWatched <= 0) return;
    if (furthestRef.current > 0.5) return;
    const target = Math.min(savedWatched, lesson.duration);
    resumeAtRef.current = target;
    furthestRef.current = target;
    setFurthest(target);
    setT(target);
    const v = videoRef.current;
    if (v && videoSrc) {
      v.currentTime = Math.min(target, v.duration || target);
    }
  }, [savedWatched, lesson, videoSrc]);

  // Persist watched_seconds on an interval driven by furthestRef so the
  // <video> never re-renders for saves. Completed flag is read from a ref.
  useEffect(() => {
    if (!user || !lesson) return;
    const id = setInterval(() => {
      if (Date.now() - lastSaveRef.current < 7000) return;
      lastSaveRef.current = Date.now();
      saveLessonProgress(user.id, lesson.id, furthestRef.current, completedRef.current);
    }, 8000);
    return () => clearInterval(id);
  }, [user, lesson]);

  // Persist on tab close / navigation away.
  // beforeunload fires after most fetches have already been cancelled by the
  // browser, so a regular Supabase call here is unreliable under load. We
  // additionally listen to `pagehide` (more reliable on mobile / bfcache) and
  // queue a best-effort save through saveLessonProgress, which itself dedupes
  // in-flight writes so we never stack overlapping requests on close.
  useEffect(() => {
    const flush = () => {
      if (user && lesson) {
        try { saveLessonProgress(user.id, lesson.id, furthestRef.current, completedRef.current); } catch { /* ignore */ }
      }
    };
    window.addEventListener('beforeunload', flush);
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [user, lesson]);

  // Auto-pause if the learner switches tabs / windows / minimises while the
  // video is still being watched for the first time. Once the lesson has
  // hit 100% (completedRef is true), this restriction is lifted — the user
  // can keep the video open on another monitor while reviewing.
  useEffect(() => {
    const pauseIfPlaying = (reason: string) => {
      if (completedRef.current) return; // post-completion: no tab-switch enforcement
      const v = videoRef.current;
      if (!v || v.paused) return;
      v.pause();
      setShowNote(reason);
      setTimeout(() => setShowNote(null), 2200);
    };
    const onVisibility = () => {
      if (document.hidden) pauseIfPlaying('Video paused — return to this tab to keep watching.');
    };
    const onBlur = () => pauseIfPlaying('Video paused — switch back to this window to resume.');
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  // Block keyboard skip / scrub shortcuts (Arrow keys, J, L, Home, End,
  // PageUp, PageDown, number keys 0-9 which jump %). Space and K (play/pause)
  // are still allowed because they don't seek the video.
  useEffect(() => {
    const blocked = new Set([
      'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
      'Home', 'End', 'PageUp', 'PageDown',
      'KeyJ', 'KeyL',
      'Digit0', 'Digit1', 'Digit2', 'Digit3', 'Digit4',
      'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9',
    ]);
    const onKey = (e: KeyboardEvent) => {
      // Don't interfere with input fields elsewhere on the page.
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (!blocked.has(e.code)) return;
      // Only enforce when the video is the focus context — i.e. this player
      // is mounted. We're inside the player component so this is always true.
      e.preventDefault();
      e.stopPropagation();
      if (!completedRef.current) {
        setShowNote('Skipping ahead is disabled — keep watching.');
        setTimeout(() => setShowNote(null), 1400);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const startedRef = useRef(false);
  useEffect(() => { startedRef.current = false; }, [activeId]);
  const seekGuardRef = useRef(false);
  // Throttle React state updates from timeupdate. The browser fires this 4-15
  // times per second; turning every event into a setState causes the entire
  // Player tree (including the lesson sidebar list) to re-reconcile that
  // often. We update displayed time at most ~3 Hz while still tracking the
  // real currentTime in refs every event (so seek-guard logic remains exact).
  const lastUiTickRef = useRef(0);
  const onTimeUpdate = () => {
    const v = videoRef.current; if (!v) return;
    const cur = v.currentTime;
    const prevFurthest = furthestRef.current;
    // Restrict forward seeking: user must watch the entire video.
    // Allow a tiny tolerance for normal playback jitter.
    if (!seekGuardRef.current && cur > prevFurthest + 0.35) {
      seekGuardRef.current = true;
      v.currentTime = prevFurthest;
      setShowNote(`Skipping ahead is disabled — keep watching.`);
      setTimeout(() => setShowNote(null), 1600);
      // Let the next timeupdate proceed normally.
      setTimeout(() => { seekGuardRef.current = false; }, 200);
      return;
    }
    if (cur > prevFurthest) {
      furthestRef.current = cur;
    }
    const now = Date.now();
    if (now - lastUiTickRef.current >= 333) {
      lastUiTickRef.current = now;
      setT(cur);
      if (cur > furthestRef.current - 0.001) setFurthest(furthestRef.current);
    }
    // First-watch ping: persist immediately so course flips to "In progress" without waiting.
    if (!startedRef.current && cur > 0.5 && user && lesson) {
      startedRef.current = true;
      lastSaveRef.current = Date.now();
      saveLessonProgress(user.id, lesson.id, Math.max(resumeAtRef.current, cur), completedRef.current);
    }
  };

  const enforceNoForwardSeek = () => {
    const v = videoRef.current;
    if (!v) return;
    const prevFurthest = furthestRef.current;
    if (v.currentTime > prevFurthest + 0.35) {
      seekGuardRef.current = true;
      v.currentTime = prevFurthest;
      setShowNote(`Skipping ahead is disabled — keep watching.`);
      setTimeout(() => setShowNote(null), 1600);
      setTimeout(() => { seekGuardRef.current = false; }, 200);
    }
  };

  const flushProgress = () => {
    if (!user || !lesson) return;
    lastSaveRef.current = Date.now();
    saveLessonProgress(user.id, lesson.id, furthestRef.current, completedRef.current);
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) { document.exitFullscreen(); return; }
    // Fullscreen the frame (not the <video>) so browsers don't switch to a native
    // fullscreen player UI that may show a progress bar.
    const el = frameRef.current;
    if (el?.requestFullscreen) el.requestFullscreen();
  };

  const togglePlay = async () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) await v.play();
    else v.pause();
  };

  if (!courseId) {
    return <div style={{padding:40}}><EmptyState icon="🎬" title="Pick a course" sub="Open a course from your dashboard to start watching." action={<Btn onClick={()=>onNav('courses')}>Browse courses</Btn>}/></div>;
  }
  if (loading || !course) return <div style={{padding:40, color:'#5B6A7D', fontSize:13}}>Loading…</div>;
  // Strict access — user is not enrolled in this course (and is not in the
  // assignment scope). Show a clear message and a way back instead of the
  // bare-bones Player UI with no lessons.
  if (accessDenied) {
    return <div style={{padding:40}}><EmptyState icon="🔒" title="You don't have access to this course" sub="This course wasn't assigned to you. Please contact your admin if this is unexpected." action={<Btn onClick={()=>onNav('courses')}>Back to my courses</Btn>}/></div>;
  }
  if (lessons.length === 0) {
    return <div style={{padding:40}}><EmptyState icon="📼" title="No videos yet" sub="This course doesn't have any lessons published yet." action={<Btn variant="ghost" onClick={()=>onNav('courses')}>Back to courses</Btn>}/></div>;
  }
  if (!lesson) return null;

  const switchLesson = (id: string) => {
    const idx = lessons.findIndex(l => l.id === id);
    if (locks[idx]) { setShowNote('Locked — finish the previous video & assessment first.'); setTimeout(() => setShowNote(null), 2200); return; }
    setActiveId(id);
  };

  const serverWatched = lesson ? (progress[lesson.id]?.watched_seconds ?? 0) : 0;
  const effectiveWatched = Math.max(furthest, serverWatched);
  const watchedPct = DUR ? (effectiveWatched / DUR) * 100 : 0;
  const serverCompleted = !!(lesson && progress[lesson.id]?.completed);
  const unlocked = serverCompleted || watchedPct >= UNLOCK_THRESHOLD * 100;
  const goToQuiz = async () => {
    // Save current watch position; do NOT mark completed — that happens on assessment pass.
    if (user && lesson) await saveLessonProgress(user.id, lesson.id, furthest, !!progress[lesson.id]?.completed);
    setState({ ...state, course: course.id, activeLesson: lesson.id });
    onNav('assessment');
    reload();
  };

  const courseProgress = lessons.length
    ? Math.round(
        (lessons.reduce((sum, l) => {
          const p = progress[l.id];
          return sum + lessonRatio(l.duration, p?.watched_seconds || 0, !!p?.completed);
        }, 0) /
          lessons.length) *
          100
      )
    : 0;

  // Compliance progression for THIS lesson
  const lessonProgress = lesson ? progress[lesson.id] : null;
  const lessonAttempts = lesson ? (attemptsByLesson[lesson.id] || []) : [];
  const stepVideoDone = !!lessonProgress?.completed || (DUR > 0 && (lessonProgress?.watched_seconds ?? 0) >= DUR);
  const stepQuizDone = lessonAttempts.some(a => a.passed);
  const agreementGate = !!course?.agreement_required;
  const stepAgreementDone = !agreementGate || hasSignedAgreement;
  const stepCompleted = stepVideoDone && stepQuizDone && stepAgreementDone;

  return (
    <div style={{padding:'24px 36px 48px', animation:'fadeUp .3s ease-out', display:'grid', gridTemplateColumns:'1fr 340px', gap:20}}>
      {showComplianceModal && (
        <ComplianceWizardModal
          courseTitle={course.title}
          agreementRequired={agreementGate}
          onAcknowledge={acknowledgeCompliance}
        />
      )}
      <div>
        <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:14, fontSize:12, color:'#5B6A7D'}}>
          <a onClick={()=>onNav('courses')} style={{cursor:'pointer'}}>My Courses</a>
          <span>›</span>
          <a style={{color:'#3B4A5E'}}>{course.title}</a>
          <span>›</span>
          <span style={{color:'#0A1F3D', fontWeight:600}}>Video {lessonIdx+1}</span>
        </div>

        {/* Compliance step indicator: Watch → Assessment → Sign → Done */}
        <ComplianceStepIndicator
          videoDone={stepVideoDone}
          quizDone={stepQuizDone}
          agreementRequired={agreementGate}
          agreementDone={stepAgreementDone}
          completed={stepCompleted}
        />

        {/* Compliance reminder: video + assessment done but agreement still unsigned.
            The course is NOT marked completed in this state. */}
        {agreementGate && stepVideoDone && stepQuizDone && !stepAgreementDone && (
          <div style={{marginBottom:14, padding:'12px 16px', background:'#FFF6E6', border:'1px solid #FCD79B', borderRadius:10, display:'flex', alignItems:'center', gap:12}}>
            <div style={{fontSize:18}}>⚠️</div>
            <div style={{flex:1}}>
              <div style={{fontSize:13, fontWeight:700, color:'#9A6708'}}>Agreement signing — incomplete</div>
              <div style={{fontSize:12, color:'#9A6708', marginTop:2}}>
                You've watched the video and passed the assessment, but the course will not be marked complete until you sign the agreement.
              </div>
            </div>
            <Btn size="sm" onClick={() => onNav('assessment')}>Sign agreement</Btn>
          </div>
        )}


        <div ref={frameRef} style={{position:'relative', background:'#0A1F3D', borderRadius:16, overflow:'hidden', aspectRatio:'16/9', boxShadow:'0 12px 32px rgba(0,42,75,.15)'}}>
          {videoSrc ? (
            <video
              ref={videoRef}
              src={videoSrc}
              onTimeUpdate={onTimeUpdate}
              onPlay={() => setPaused(false)}
              onPause={() => { setPaused(true); flushProgress(); }}
              onEnded={() => {
                // Snap to full duration so floating-point drift in
                // currentTime (e.g. 99.7s on a 100s video) doesn't keep
                // the assessment locked. Mark completed locally, persist,
                // and refetch so the unlock state updates without a
                // manual page refresh.
                if (DUR > 0) {
                  furthestRef.current = DUR;
                  setFurthest(DUR);
                  setT(DUR);
                }
                completedRef.current = true;
                if (user && lesson) {
                  saveLessonProgress(user.id, lesson.id, DUR || furthestRef.current, true)
                    .then(() => reload())
                    .catch(() => reload());
                }
              }}
              onSeeking={enforceNoForwardSeek}
              onSeeked={() => { enforceNoForwardSeek(); flushProgress(); }}
              onClick={togglePlay}
              onContextMenu={(e) => e.preventDefault()}
              controls={false}
              controlsList="nodownload noplaybackrate noremoteplayback"
              disablePictureInPicture
              disableRemotePlayback
              playsInline
              style={{width:'100%', height:'100%', background:'#000', objectFit:'contain', cursor:'pointer'}}
            />
          ) : (
            <div style={{position:'absolute', inset:0, display:'grid', placeItems:'center', color:'#fff', fontSize:13}}>Loading video…</div>
          )}

          <div style={{position:'absolute', top:12, right:12, display:'flex', alignItems:'center', gap:8}}>
            <div style={{display:'flex', alignItems:'center', gap:8, padding:'5px 12px', background:'rgba(0,0,0,.55)', backdropFilter:'blur(8px)', borderRadius:999, color:'#fff', fontSize:11, fontWeight:600}}>
              <span style={{width:7, height:7, background:'#22D38A', borderRadius:99, boxShadow:'0 0 0 4px rgba(34,211,138,.18)'}}/> {Math.round(watchedPct)}% watched
            </div>
            <button onClick={toggleFullscreen} title="Fullscreen" style={{padding:'6px 10px', background:'rgba(0,0,0,.55)', backdropFilter:'blur(8px)', border:0, borderRadius:999, color:'#fff', fontSize:11, fontWeight:700, cursor:'pointer', display:'flex', alignItems:'center', gap:6}}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6"/></svg>
              Fullscreen
            </button>
          </div>

          {showNote && (
            <div style={{position:'absolute', top:16, left:'50%', transform:'translateX(-50%)', padding:'9px 14px', background:'rgba(194,38,29,.95)', color:'#fff', borderRadius:8, fontSize:12, fontWeight:600}}>{showNote}</div>
          )}

          {/* Custom controls (no scrubbing forward, no speed switch, no volume control) */}
          <div style={{position:'absolute', left:0, right:0, bottom:0, padding:'10px 12px', background:'linear-gradient(to top, rgba(0,0,0,.65), rgba(0,0,0,0))'}}>
            <div style={{display:'flex', alignItems:'center', gap:10}}>
              <button onClick={togglePlay} style={{width:36, height:36, borderRadius:12, border:'1px solid rgba(255,255,255,.14)', background:'rgba(0,0,0,.45)', color:'#fff', cursor:'pointer', fontWeight:800}}>
                {paused ? '▶' : '⏸'}
              </button>
              <div style={{minWidth:96, fontSize:12, color:'rgba(255,255,255,.9)', fontWeight:700}}>
                {fmt(t)} / {fmt(DUR)}
              </div>
              <div style={{flex:1, position:'relative', height:24, display:'flex', alignItems:'center'}}>
                {/* Track background */}
                <div style={{position:'absolute', left:0, right:0, height:4, background:'rgba(255,255,255,.18)', borderRadius:99}}/>
                {/* Watched (rewindable) region */}
                <div style={{position:'absolute', left:0, width: DUR ? `${Math.min(100, (furthest / DUR) * 100)}%` : '0%', height:4, background:'rgba(34,211,138,.85)', borderRadius:99}}/>
                {/* Current position marker */}
                <div style={{position:'absolute', left: DUR ? `${Math.min(100, (t / DUR) * 100)}%` : '0%', width:12, height:12, marginLeft:-6, background:'#fff', borderRadius:99, boxShadow:'0 0 0 2px rgba(0,114,255,.6)'}}/>
                <input
                  type="range"
                  min={0}
                  max={Math.max(1, DUR)}
                  step={0.1}
                  value={Math.min(t, DUR)}
                  onChange={(e) => {
                    const v = videoRef.current; if (!v) return;
                    const target = Number(e.target.value);
                    // Allow backward seek only; clamp forward attempts to furthest watched.
                    if (target > furthestRef.current + 0.35) {
                      v.currentTime = furthestRef.current;
                      setT(furthestRef.current);
                      setShowNote('Skipping ahead is disabled — keep watching.');
                      setTimeout(() => setShowNote(null), 1600);
                      return;
                    }
                    v.currentTime = target;
                    setT(target);
                  }}
                  title="Rewind only — you cannot skip ahead"
                  style={{position:'absolute', left:0, right:0, width:'100%', height:24, opacity:0, cursor:'pointer', margin:0}}
                />
              </div>
            </div>
          </div>
        </div>

        <div style={{marginTop:16}}>
          <Card pad={18} style={{display:'flex', alignItems:'center', gap:16, borderColor: unlocked ? '#CCEAFF' : '#EEF2F7', background: unlocked ? 'linear-gradient(90deg,#F2F9FF,#fff)' : '#fff'}}>
            <div style={{width:42, height:42, borderRadius:10, background: unlocked ? '#E6F4FF' : '#F7F9FC', color: unlocked ? '#0072FF' : '#8A97A8', display:'grid', placeItems:'center'}}>
              <Icon d="M6 3h9l4 4v14a2 2 0 01-2 2H6a2 2 0 01-2-2V5a2 2 0 012-2zM14 3v5h5M8 13l3 3 5-6" size={18}/>
            </div>
            <div style={{flex:1}}>
              <div style={{fontSize:14, fontWeight:700, color:'#0A1F3D'}}>{unlocked ? 'Assessment unlocked' : `Watch the full video (${Math.ceil(UNLOCK_THRESHOLD*100)}%) to unlock the assessment`}</div>
              <div style={{fontSize:12, color:'#5B6A7D', marginTop:2}}>{Math.round(watchedPct)}% watched · {fmt(furthest)} of {fmt(DUR)}</div>
              <div style={{marginTop:6}}><ProgressBar value={Math.min(100, Math.round(watchedPct))} height={4}/></div>
            </div>
            <Btn disabled={!unlocked} onClick={goToQuiz}>{unlocked ? 'Start assessment →' : 'Locked'}</Btn>
          </Card>
        </div>

        {/* Optional reading material — supplementary, not gated by completion */}
        {lesson.reading_material_path && (() => {
          const url = getReadingMaterialUrl(lesson.reading_material_path);
          if (!url) return null;
          const label = lesson.reading_material_name || 'Reading material';
          return (
            <div style={{marginTop:12}}>
              <Card pad={16} style={{display:'flex', alignItems:'center', gap:14, background:'#F7F9FC', borderColor:'#EEF2F7'}}>
                <div style={{width:38, height:38, borderRadius:10, background:'#FFF6E6', color:'#9A6708', display:'grid', placeItems:'center', fontSize:18}}>📘</div>
                <div style={{flex:1, minWidth:0}}>
                  <div style={{fontSize:13, fontWeight:700, color:'#0A1F3D'}}>{label}</div>
                  <div style={{fontSize:11, color:'#5B6A7D', marginTop:2}}>Optional reading — not required to complete this lesson.</div>
                </div>
                <a href={url} target="_blank" rel="noreferrer" style={{textDecoration:'none'}}>
                  <Btn variant="ghost" size="sm">Open ↗</Btn>
                </a>
              </Card>
            </div>
          );
        })()}
      </div>

      <div>
        <Card pad={0}>
          <div style={{padding:'16px 18px', borderBottom:'1px solid #EEF2F7'}}>
            <div style={{fontSize:11, fontWeight:600, color:'#8A97A8', letterSpacing:'.06em', textTransform:'uppercase'}}>In this course</div>
            <div style={{fontSize:14, fontWeight:700, color:'#0A1F3D', marginTop:4}}>{course.title}</div>
            <div style={{marginTop:10}}><ProgressBar value={courseProgress} showLabel/></div>
            <div style={{fontSize:11, color:'#5B6A7D', marginTop:6}}>{lessons.filter(l=>progress[l.id]?.completed).length} of {lessons.length} videos complete</div>
          </div>
          <div style={{maxHeight:520, overflowY:'auto'}}>
            {lessons.map((l,i) => {
              const active = l.id === activeId;
              const p = progress[l.id];
              const passedAttempts = (attemptsByLesson[l.id] || []).filter(a => a.passed);
              const bestPass = passedAttempts.reduce((m, a) => Math.max(m, Math.round((a.score/a.total)*100)), 0);
              const wpct = p ? Math.min(100, (p.watched_seconds / Math.max(1, l.duration)) * 100) : 0;
              const locked = locks[i];
              const done = !!p?.completed;
              return (
                <div key={l.id} onClick={()=>switchLesson(l.id)} style={{padding:'12px 16px', borderBottom:'1px solid #F7F9FC', cursor: locked?'not-allowed':'pointer', background: active?'#F2F9FF':'transparent', opacity: locked?.55:1, display:'flex', gap:12, alignItems:'flex-start'}}>
                  <div style={{width:26, height:26, borderRadius:99, background: done?'#17A674':active?'#0072FF':'#EEF2F7', color: (done||active)?'#fff':'#5B6A7D', display:'grid', placeItems:'center', fontSize:11, fontWeight:700, flexShrink:0}}>
                    {done ? '✓' : locked ? '🔒' : i+1}
                  </div>
                  <div style={{flex:1, minWidth:0}}>
                    <div style={{fontSize:13, fontWeight: active?700:600, color: active?'#0A1F3D':'#3B4A5E'}}>{l.title}</div>
                    <div style={{fontSize:11, color:'#8A97A8', marginTop:2, display:'flex', gap:8, alignItems:'center'}}>
                      <span>{fmt(l.duration)}</span>
                      {bestPass > 0 && <span style={{color:'#17A674', fontWeight:600}}>· Assessment {bestPass}%</span>}
                    </div>
                    {wpct>0 && wpct<100 && <div style={{marginTop:6}}><ProgressBar value={Math.round(wpct)} height={3}/></div>}
                  </div>
                </div>
              );
            })}
            {/* Agreement entry — appears once all lessons have a passing attempt
                AND the course requires an agreement AND the learner hasn't
                signed yet. Hidden after signing. */}
            {(() => {
              if (!agreementGate) return null;
              if (hasSignedAgreement) return null;
              const allLessonsPassed = lessons.length > 0 && lessons.every(l => (attemptsByLesson[l.id] || []).some(a => a.passed));
              const agreementUnlocked = allLessonsPassed;
              const goSign = () => {
                if (!agreementUnlocked) {
                  setShowNote('Pass the assessment first to unlock the agreement.');
                  setTimeout(() => setShowNote(null), 2200);
                  return;
                }
                // Route through assessment → agreement stage by activating the
                // last lesson and navigating to assessment, which renders the
                // AgreementSign view when needsSignature is true.
                const last = lessons[lessons.length - 1];
                if (last) {
                  setState({ ...state, course: course.id, activeLesson: last.id });
                  onNav('assessment');
                }
              };
              return (
                <div onClick={goSign} style={{padding:'12px 16px', borderBottom:'1px solid #F7F9FC', cursor: agreementUnlocked?'pointer':'not-allowed', background:'transparent', opacity: agreementUnlocked?1:.55, display:'flex', gap:12, alignItems:'flex-start'}}>
                  <div style={{width:26, height:26, borderRadius:99, background: agreementUnlocked?'#0072FF':'#EEF2F7', color: agreementUnlocked?'#fff':'#5B6A7D', display:'grid', placeItems:'center', fontSize:11, fontWeight:700, flexShrink:0}}>
                    {agreementUnlocked ? '✍️' : '🔒'}
                  </div>
                  <div style={{flex:1, minWidth:0}}>
                    <div style={{fontSize:13, fontWeight:700, color:'#0A1F3D'}}>Sign agreement</div>
                    <div style={{fontSize:11, color:'#8A97A8', marginTop:2}}>
                      {agreementUnlocked ? 'Read & sign to complete the course' : 'Unlocks after passing the assessment'}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </Card>
      </div>
    </div>
  );
}

// =============================================================================
// Compliance UI helpers
// =============================================================================

// Single-popup compliance acknowledgement shown the first time a learner opens a course.
// Lists all 3 steps in one panel — Video, Assessment, and (optionally) Document.
function ComplianceWizardModal({ courseTitle, agreementRequired, onAcknowledge }: { courseTitle: string; agreementRequired: boolean; onAcknowledge: () => void }) {
  const steps: { tag: string; text: string }[] = [
    { tag: 'Step 1 — Video', text: 'You must watch the entire compliance training video without skipping or tab switching.' },
    { tag: 'Step 2 — Assessment', text: 'Compliance assessment requires 100% correct answers. If any answer is wrong, the assessment restarts.' },
  ];
  if (agreementRequired) {
    steps.push({ tag: 'Step 3 — Document', text: 'You must read the complete compliance document before signing.' });
  }

  return (
    <div style={{position:'fixed', inset:0, background:'rgba(10,31,61,.6)', zIndex:2000, display:'grid', placeItems:'center', padding:24}}>
      <div style={{background:'#fff', borderRadius:14, maxWidth:560, width:'100%', overflow:'hidden', boxShadow:'0 20px 60px rgba(0,0,0,.3)'}}>
        <div style={{padding:'24px 28px 20px', background:'linear-gradient(135deg,#0A1F3D,#0072FF)', color:'#fff'}}>
          <div style={{fontSize:11, fontWeight:700, letterSpacing:'.12em', color:'#9EC9F0', textTransform:'uppercase'}}>Compliance Steps</div>
          <div style={{fontSize:18, fontWeight:800, marginTop:6, letterSpacing:'-.01em'}}>Before you begin</div>
          <div style={{fontSize:12, color:'#C8DDF4', marginTop:6}}>{courseTitle}</div>
        </div>

        <div style={{padding:'22px 28px 8px', display:'flex', flexDirection:'column', gap:16}}>
          {steps.map((s) => (
            <div key={s.tag}>
              <div style={{fontSize:11, fontWeight:700, letterSpacing:'.08em', color:'#0072FF', textTransform:'uppercase', marginBottom:6}}>{s.tag}</div>
              <div style={{fontSize:14, color:'#0A1F3D', lineHeight:1.55}}>{s.text}</div>
            </div>
          ))}
        </div>

        <div style={{padding:'18px 28px 22px', display:'flex', justifyContent:'flex-end'}}>
          <Btn size="lg" onClick={onAcknowledge}>I Understand</Btn>
        </div>
      </div>
    </div>
  );
}

function ComplianceStepIndicator({ videoDone, quizDone, agreementRequired, agreementDone, completed }: { videoDone: boolean; quizDone: boolean; agreementRequired: boolean; agreementDone: boolean; completed: boolean }) {
  const steps = [
    { label: 'Watch video', done: videoDone },
    { label: 'Assessment', done: quizDone },
    ...(agreementRequired ? [{ label: 'Sign agreement', done: agreementDone }] : []),
    { label: 'Completed', done: completed },
  ];
  return (
    <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:14, padding:'10px 14px', background:'#fff', border:'1px solid #EEF2F7', borderRadius:10}}>
      {steps.map((s, i) => (
        <div key={s.label} style={{display:'flex', alignItems:'center', gap:8, flex:1}}>
          <div style={{display:'flex', alignItems:'center', gap:8, flex:1}}>
            <div style={{width:24, height:24, borderRadius:99, background: s.done ? '#17A674' : '#EEF2F7', color: s.done ? '#fff' : '#8A97A8', display:'grid', placeItems:'center', fontWeight:800, fontSize:12, flexShrink:0}}>
              {s.done ? '✓' : i + 1}
            </div>
            <div style={{fontSize:12, fontWeight: s.done ? 700 : 600, color: s.done ? '#0A1F3D' : '#5B6A7D', whiteSpace:'nowrap'}}>{s.label}</div>
          </div>
          {i < steps.length - 1 && (
            <div style={{flex:1, height:2, background: s.done ? '#17A674' : '#EEF2F7', borderRadius:99}}/>
          )}
        </div>
      ))}
    </div>
  );
}

