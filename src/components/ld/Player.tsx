import { useState, useEffect, useRef } from "react";
import { useCourseLessons, saveLessonProgress, getVideoUrl } from "./queries";
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
  const [course, setCourse] = useState<{ id: string; title: string; instructor: string; emoji: string; duration_label: string } | null>(null);
  const { lessons, progress, attemptsByLesson, loading, reload } = useCourseLessons(courseId, user?.id ?? null);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!courseId) return;
    supabase.from('courses').select('id, title, instructor, emoji, duration_label').eq('id', courseId).maybeSingle()
      .then(({ data }) => setCourse(data));
  }, [courseId]);

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
  const [speed, setSpeed] = useState<1 | 1.5>(1);
  const [paused, setPaused] = useState(true);
  const [muted, setMuted] = useState(false);
  const [vol, setVol] = useState(1);
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

  // Apply playback speed (we intentionally only allow 1x or 1.5x).
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = speed;
  }, [speed, videoSrc]);

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

  // Persist on tab close / navigation away
  useEffect(() => {
    const flush = () => {
      if (user && lesson) saveLessonProgress(user.id, lesson.id, furthestRef.current, completedRef.current);
    };
    window.addEventListener('beforeunload', flush);
    return () => { window.removeEventListener('beforeunload', flush); flush(); };
  }, [user, lesson]);

  // Auto-pause if learner switches tabs or windows. Forces full attention
  // on the video — no playing in the background while another tab is focused.
  useEffect(() => {
    const pauseIfPlaying = (reason: string) => {
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

  const startedRef = useRef(false);
  useEffect(() => { startedRef.current = false; }, [activeId]);
  const seekGuardRef = useRef(false);
  const onTimeUpdate = () => {
    const v = videoRef.current; if (!v) return;
    const cur = v.currentTime;
    setT(cur);
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
      setFurthest(cur);
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

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  };

  const setVolume = (value: number) => {
    const v = videoRef.current;
    if (!v) return;
    const next = Math.max(0, Math.min(1, value));
    v.volume = next;
    setVol(next);
    if (next > 0 && v.muted) {
      v.muted = false;
      setMuted(false);
    }
  };

  if (!courseId) {
    return <div style={{padding:40}}><EmptyState icon="🎬" title="Pick a course" sub="Open a course from your dashboard to start watching." action={<Btn onClick={()=>onNav('courses')}>Browse courses</Btn>}/></div>;
  }
  if (loading || !course) return <div style={{padding:40, color:'#5B6A7D', fontSize:13}}>Loading…</div>;
  if (lessons.length === 0) {
    return <div style={{padding:40}}><EmptyState icon="📼" title="No videos yet" sub="This course doesn't have any lessons published yet." action={<Btn variant="ghost" onClick={()=>onNav('courses')}>Back to courses</Btn>}/></div>;
  }
  if (!lesson) return null;

  const switchLesson = (id: string) => {
    const idx = lessons.findIndex(l => l.id === id);
    if (locks[idx]) { setShowNote('Locked — finish the previous video & quiz first.'); setTimeout(() => setShowNote(null), 2200); return; }
    setActiveId(id);
  };

  const watchedPct = DUR ? (furthest / DUR) * 100 : 0;
  const unlocked = watchedPct >= UNLOCK_THRESHOLD * 100;
  const goToQuiz = async () => {
    // Save current watch position; do NOT mark completed — that happens on quiz pass.
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

  return (
    <div style={{padding:'24px 36px 48px', animation:'fadeUp .3s ease-out', display:'grid', gridTemplateColumns:'1fr 340px', gap:20}}>
      <div>
        <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:14, fontSize:12, color:'#5B6A7D'}}>
          <a onClick={()=>onNav('courses')} style={{cursor:'pointer'}}>My Courses</a>
          <span>›</span>
          <a style={{color:'#3B4A5E'}}>{course.title}</a>
          <span>›</span>
          <span style={{color:'#0A1F3D', fontWeight:600}}>Video {lessonIdx+1}</span>
        </div>

        <div ref={frameRef} style={{position:'relative', background:'#0A1F3D', borderRadius:16, overflow:'hidden', aspectRatio:'16/9', boxShadow:'0 12px 32px rgba(0,42,75,.15)'}}>
          {videoSrc ? (
            <video
              ref={videoRef}
              src={videoSrc}
              onTimeUpdate={onTimeUpdate}
              onPlay={() => setPaused(false)}
              onPause={() => { setPaused(true); flushProgress(); }}
              onEnded={flushProgress}
              onSeeking={enforceNoForwardSeek}
              onSeeked={() => { enforceNoForwardSeek(); flushProgress(); }}
              controls={false}
              controlsList="nodownload noplaybackrate"
              disablePictureInPicture
              playsInline
              style={{width:'100%', height:'100%', background:'#000', objectFit:'contain'}}
            />
          ) : (
            <div style={{position:'absolute', inset:0, display:'grid', placeItems:'center', color:'#fff', fontSize:13}}>Loading video…</div>
          )}

          <div style={{position:'absolute', top:12, right:12, display:'flex', alignItems:'center', gap:8}}>
            <div style={{display:'flex', alignItems:'center', gap:8, padding:'5px 12px', background:'rgba(0,0,0,.55)', backdropFilter:'blur(8px)', borderRadius:999, color:'#fff', fontSize:11, fontWeight:600}}>
              <span style={{width:7, height:7, background:'#22D38A', borderRadius:99, boxShadow:'0 0 0 4px rgba(34,211,138,.18)'}}/> {Math.round(watchedPct)}% watched
            </div>
            <button
              onClick={() => setSpeed(s => (s === 1 ? 1.5 : 1))}
              title="Playback speed"
              style={{padding:'6px 10px', background:'rgba(0,0,0,.55)', backdropFilter:'blur(8px)', border:'1px solid rgba(255,255,255,.12)', borderRadius:999, color:'#fff', fontSize:11, fontWeight:800, cursor:'pointer'}}
            >
              {speed}x
            </button>
            <button onClick={toggleFullscreen} title="Fullscreen" style={{padding:'6px 10px', background:'rgba(0,0,0,.55)', backdropFilter:'blur(8px)', border:0, borderRadius:999, color:'#fff', fontSize:11, fontWeight:700, cursor:'pointer', display:'flex', alignItems:'center', gap:6}}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6"/></svg>
              Fullscreen
            </button>
          </div>

          {showNote && (
            <div style={{position:'absolute', top:16, left:'50%', transform:'translateX(-50%)', padding:'9px 14px', background:'rgba(194,38,29,.95)', color:'#fff', borderRadius:8, fontSize:12, fontWeight:600}}>{showNote}</div>
          )}

          {/* Custom controls (prevents forward scrubbing) */}
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
              <button onClick={toggleMute} style={{padding:'8px 10px', borderRadius:10, border:'1px solid rgba(255,255,255,.14)', background:'rgba(0,0,0,.45)', color:'#fff', cursor:'pointer', fontSize:12, fontWeight:800}}>
                {muted || vol === 0 ? '🔇' : '🔊'}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : vol}
                onChange={(e) => setVolume(Number(e.target.value))}
                style={{width:84}}
              />
            </div>
          </div>
        </div>

        <div style={{marginTop:16}}>
          <Card pad={18} style={{display:'flex', alignItems:'center', gap:16, borderColor: unlocked ? '#CCEAFF' : '#EEF2F7', background: unlocked ? 'linear-gradient(90deg,#F2F9FF,#fff)' : '#fff'}}>
            <div style={{width:42, height:42, borderRadius:10, background: unlocked ? '#E6F4FF' : '#F7F9FC', color: unlocked ? '#0072FF' : '#8A97A8', display:'grid', placeItems:'center'}}>
              <Icon d="M6 3h9l4 4v14a2 2 0 01-2 2H6a2 2 0 01-2-2V5a2 2 0 012-2zM14 3v5h5M8 13l3 3 5-6" size={18}/>
            </div>
            <div style={{flex:1}}>
              <div style={{fontSize:14, fontWeight:700, color:'#0A1F3D'}}>{unlocked ? 'Assessment unlocked' : `Watch ${Math.ceil(UNLOCK_THRESHOLD*100)}% to unlock the assessment`}</div>
              <div style={{fontSize:12, color:'#5B6A7D', marginTop:2}}>{Math.round(watchedPct)}% watched · {fmt(furthest)} of {fmt(DUR)}</div>
              <div style={{marginTop:6}}><ProgressBar value={Math.min(100, Math.round(watchedPct))} height={4}/></div>
            </div>
            <Btn disabled={!unlocked} onClick={goToQuiz}>{unlocked ? 'Start quiz →' : 'Locked'}</Btn>
          </Card>
        </div>
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
                      {bestPass > 0 && <span style={{color:'#17A674', fontWeight:600}}>· Quiz {bestPass}%</span>}
                    </div>
                    {wpct>0 && wpct<100 && <div style={{marginTop:6}}><ProgressBar value={Math.round(wpct)} height={3}/></div>}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}
