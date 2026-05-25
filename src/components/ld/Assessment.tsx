import { useState, useEffect, useRef } from "react";
import { useMCQ, useCourseLessons, recordAttempt, saveLessonProgress } from "./queries";
import { useAuth } from "./auth";
import { supabase } from "@/integrations/supabase/client";
import { Btn, Card, Chip, ProgressBar, EmptyState } from "./ui";
import type { Nav, AppState } from "./App";

export function Assessment({ onNav, state, setState }: { onNav: Nav; state: AppState; setState: (s: AppState) => void }) {
  const { user } = useAuth();
  const [course, setCourse] = useState<{ id: string; title: string } | null>(null);
  const { lessons } = useCourseLessons(state.course, user?.id ?? null);
  const activeLessonId = state.activeLesson;
  const lesson = lessons.find(l => l.id === activeLessonId);
  const lessonIdx = lessons.findIndex(l => l.id === activeLessonId);
  const nextLesson = lessons[lessonIdx + 1];
  const { questions, loading } = useMCQ(activeLessonId);

  // No separate intro/start card — the quiz begins immediately (the Player's
  // start card is the single entry point). Only 'quiz' and 'result' remain.
  const [stage, setStage] = useState<'quiz'|'result'>('quiz');
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<(number|null)[]>([]);
  const [flagged, setFlagged] = useState<Set<number>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  // When non-null, quiz runs in "retake" mode — only the wrong question
  // indices are shown. Correct answers from the previous attempt are kept
  // intact in `answers` so scoring still uses the full array.
  const [retakeIndices, setRetakeIndices] = useState<number[] | null>(null);

  // Persistence — quiz state survives tab refresh / tab switch.
  // Key per (user, lesson). Cleared on submit so a retake starts fresh.
  const persistKey = user && activeLessonId ? `assessment-state-${user.id}-${activeLessonId}` : null;
  const restoredRef = useRef(false);
  useEffect(() => {
    if (!persistKey || restoredRef.current) return;
    try {
      const raw = localStorage.getItem(persistKey);
      if (raw) {
        const saved = JSON.parse(raw) as { stage?: string; idx?: number; answers?: (number|null)[]; flagged?: number[]; retakeIndices?: number[] | null };
        if (saved.stage === 'quiz' || saved.stage === 'result') setStage(saved.stage);
        if (typeof saved.idx === 'number') setIdx(saved.idx);
        if (Array.isArray(saved.answers)) setAnswers(saved.answers);
        if (Array.isArray(saved.flagged)) setFlagged(new Set(saved.flagged));
        if ('retakeIndices' in saved) setRetakeIndices(saved.retakeIndices ?? null);
      }
    } catch { /* ignore corrupt state */ }
    // CRITICAL: must always flip the gate so the save effect starts firing
    // for fresh quizzes too (previously stayed false when no saved state
    // existed → quiz restarted from scratch on every tab switch).
    restoredRef.current = true;
  }, [persistKey]);
  // Debounce the localStorage write. Synchronous JSON.stringify + setItem on
  // every keystroke can stall the main thread for users on low-end devices,
  // and at scale we don't need millisecond-perfect persistence — 200ms after
  // the last change is more than enough to survive tab switches.
  useEffect(() => {
    if (!persistKey || !restoredRef.current) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(persistKey, JSON.stringify({ stage, idx, answers, flagged: Array.from(flagged), retakeIndices }));
      } catch { /* quota or serialisation failure — ignore */ }
    }, 200);
    return () => clearTimeout(t);
  }, [persistKey, stage, idx, answers, flagged, retakeIndices]);

  // The active question list. In retake mode only the wrong questions are
  // shown; in a fresh attempt every question is included. We defensively clamp
  // retake indices to the current question set so a restored localStorage state
  // (or an admin editing the quiz mid-retake) can never index past the array
  // and crash the renderer. If every retake index is stale we fall back to the
  // full list rather than showing an empty quiz.
  const safeRetakeIndices = retakeIndices === null
    ? null
    : retakeIndices.filter(i => Number.isInteger(i) && i >= 0 && i < questions.length);
  const activeList: { question: typeof questions[number]; originalIdx: number }[] =
    safeRetakeIndices !== null && safeRetakeIndices.length > 0
      ? safeRetakeIndices.map(i => ({ question: questions[i], originalIdx: i }))
      : questions.map((q, i) => ({ question: q, originalIdx: i }));

  useEffect(() => {
    if (!questions.length) return;
    // Only initialise if we don't already have a sized array (e.g. from
    // restored localStorage state).
    setAnswers(prev => prev.length === questions.length ? prev : Array(questions.length).fill(null));
  }, [questions.length]);
  useEffect(() => {
    if (!state.course) return;
    supabase.from('courses').select('id, title').eq('id', state.course).maybeSingle().then(({ data }) => setCourse(data as typeof course));
  }, [state.course]);

  if (!state.course || !state.activeLesson) {
    return <div style={{padding:40}}><EmptyState icon="🧭" title="No assessment selected" sub="Pick a video first." action={<Btn onClick={()=>onNav('courses')}>Back to Home</Btn>}/></div>;
  }
  if (loading || !course || !lesson) {
    return <div style={{padding:40, color:'#5B6A7D', fontSize:13}}>Loading…</div>;
  }
  if (questions.length === 0) {
    return <div style={{padding:40}}><EmptyState icon="📝" title="No quiz for this lesson" sub="Your admin hasn't added questions for this lesson yet." action={<Btn onClick={()=>onNav('courses')}>Back to Home</Btn>}/></div>;
  }

  // Real lesson title, or null when it's the blank "Untitled Lesson" default.
  // Headings show the lesson name when meaningful, otherwise fall back to the
  // course title so learners never see "Untitled Lesson".
  const lessonName = lesson.title && lesson.title !== 'Untitled Lesson' ? lesson.title : null;
  // No video anywhere in this course → never say "Video" in the assessment UI.
  const courseHasVideo = lessons.some(l => !!l.video_path || l.duration > 0);

  if (stage === 'result') {
    const correct = answers.filter((a,i) => a === questions[i].correct).length;
    const pct = Math.round((correct / questions.length) * 100);
    // Compliance rule: 100% required. No partial pass.
    const pass = pct === 100;
    const wrongIndices = answers
      .map((a, i) => (a === questions[i].correct ? -1 : i))
      .filter(i => i !== -1);
    const onRetryWrong = () => {
      // Enter retake mode — only the wrong questions are presented.
      // Previously correct answers are kept in the `answers` array so the
      // final score still counts them when the learner submits the retake.
      setRetakeIndices(wrongIndices);
      setAnswers(prev => {
        const a = [...prev];
        wrongIndices.forEach(i => { a[i] = null; });
        return a;
      });
      setIdx(0);
      setFlagged(new Set());
      setStage('quiz');
    };
    const onNext = () => { if (nextLesson) { setState({ ...state, activeLesson: nextLesson.id }); onNav('player'); } else onNav('courses'); };
    return (
      <div style={{padding:'28px 40px 48px', maxWidth:1080, animation:'fadeUp .4s'}}>
        <div style={{display:'grid', gridTemplateColumns:'1.2fr 1fr', gap:20}}>
          <Card pad={0} style={{overflow:'hidden'}}>
            <div style={{padding:'36px 40px', background: pass?'linear-gradient(135deg,#0F7C57,#17A674)':'#0A1F3D', color:'#fff'}}>
              <div style={{width:52, height:52, borderRadius:14, background:'rgba(255,255,255,.14)', display:'grid', placeItems:'center', fontSize:24}}>{pass ? '✓' : '!'}</div>
              <div style={{fontSize:11, fontWeight:600, letterSpacing:'.12em', color:pass?'#D9F4E6':'#7FDBFF', marginTop:18, textTransform:'uppercase'}}>{pass?'Passed':'Not yet passed'}</div>
              <div style={{fontSize:48, fontWeight:700, letterSpacing:'-.03em', marginTop:4, lineHeight:1}}>{pct}%</div>
              <div style={{fontSize:13, color:pass?'#D9F4E6':'#C8DDF4', marginTop:6}}>{correct} of {questions.length} correct · {pass ? (nextLesson ? `Next ${courseHasVideo ? 'video' : 'lesson'} unlocked` : 'Course complete') : `${wrongIndices.length} wrong — re-attempt just those questions`}</div>
            </div>
            <div style={{padding:'30px 40px 32px'}}>
              {/* Show only the final result + score; correct answers are intentionally
                  hidden so retake attempts remain a real assessment. */}
              <div style={{display:'flex', gap:16, alignItems:'stretch'}}>
                <div style={{flex:1, padding:'18px 20px', background:'#F7F9FC', borderRadius:10, border:'1px solid #EEF2F7'}}>
                  <div style={{fontSize:11, fontWeight:700, color:'#8A97A8', letterSpacing:'.08em', textTransform:'uppercase'}}>Result</div>
                  <div style={{fontSize:22, fontWeight:800, color: pass?'#17A674':'#C2261D', marginTop:6}}>{pass ? 'Passed ✓' : 'Failed ✕'}</div>
                </div>
                <div style={{flex:1, padding:'18px 20px', background:'#F7F9FC', borderRadius:10, border:'1px solid #EEF2F7'}}>
                  <div style={{fontSize:11, fontWeight:700, color:'#8A97A8', letterSpacing:'.08em', textTransform:'uppercase'}}>Marks</div>
                  <div style={{fontSize:22, fontWeight:800, color:'#0A1F3D', marginTop:6}}>{correct} / {questions.length}</div>
                </div>
                <div style={{flex:1, padding:'18px 20px', background:'#F7F9FC', borderRadius:10, border:'1px solid #EEF2F7'}}>
                  <div style={{fontSize:11, fontWeight:700, color:'#8A97A8', letterSpacing:'.08em', textTransform:'uppercase'}}>Score</div>
                  <div style={{fontSize:22, fontWeight:800, color:'#0A1F3D', marginTop:6}}>{pct}%</div>
                </div>
              </div>
              <div style={{marginTop:18, fontSize:12, color:'#5B6A7D'}}>
                {pass
                  ? 'Great work — your completion is recorded.'
                  : `You answered ${wrongIndices.length} question${wrongIndices.length === 1 ? '' : 's'} incorrectly. Review them below, then re-attempt just those questions — every question must be correct to pass.`}
              </div>
              {!pass && wrongIndices.length > 0 && (
                <div style={{marginTop:22, padding:'18px 20px', background:'#FFF7F6', border:'1px solid #FCE1DE', borderRadius:10}}>
                  <div style={{fontSize:11, fontWeight:700, color:'#C2261D', letterSpacing:'.08em', textTransform:'uppercase', marginBottom:10}}>
                    To re-attempt · {wrongIndices.length} incorrect answer{wrongIndices.length === 1 ? '' : 's'}
                  </div>
                  <div style={{display:'flex', flexDirection:'column', gap:10}}>
                    {wrongIndices.map(i => {
                      const q = questions[i];
                      // List only the question text. We intentionally do NOT
                      // show the learner's answer, the correct answer, or any
                      // right/wrong indicator beyond the question being in
                      // this list — so retake attempts remain a real test.
                      return (
                        <div key={q.id} style={{padding:'12px 14px', background:'#fff', border:'1px solid #FCE1DE', borderRadius:8, fontSize:13, fontWeight:600, color:'#0A1F3D'}}>
                          Q{i+1}. {q.q}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              <div style={{marginTop:22, display:'flex', gap:10, flexWrap:'wrap'}}>
                {pass ? (
                  <Btn size="lg" onClick={onNext}>{nextLesson ? 'Start next lesson →' : 'Back to Home →'}</Btn>
                ) : (
                  <Btn size="lg" onClick={onRetryWrong}>Re-attempt wrong questions →</Btn>
                )}
                <Btn variant="ghost" size="lg" onClick={()=>onNav('courses')}>Back to Home</Btn>
              </div>
            </div>
          </Card>

          <div style={{display:'flex', flexDirection:'column', gap:14}}>
            <Card pad={22}>
              <div style={{fontSize:13, fontWeight:700, color:'#0A1F3D', marginBottom:8}}>What happens next</div>
              <div style={{fontSize:13, color:'#3B4A5E', lineHeight:1.6}}>
                {pass
                  ? <>Your score has been recorded. {nextLesson ? <>The next {courseHasVideo ? 'video' : 'lesson'} — <b>{nextLesson.title}</b> — is now unlocked.</> : <>You've completed this course.</>}</>
                  : <>Re-attempt the {wrongIndices.length} wrong question{wrongIndices.length === 1 ? '' : 's'} to pass. Your correct answers are already saved — only the wrong ones will be shown.</>}
              </div>
            </Card>
            <Card pad={22}>
              <div style={{fontSize:13, fontWeight:700, color:'#0A1F3D', marginBottom:10}}>Course progress</div>
              <ProgressBar value={Math.round(((lessonIdx+1)/lessons.length)*100)} showLabel/>
              <div style={{fontSize:12, color:'#5B6A7D', marginTop:8}}>{course.title}</div>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  // `idx` is the position within activeList (NOT the original question index).
  // `originalIdx` is the position in the full questions[] array — used for
  // reading/writing the answer slot and scoring.
  const activeEntry = activeList[idx] ?? activeList[0];
  const q = activeEntry.question;
  const originalIdx = activeEntry.originalIdx;
  const selected = answers[originalIdx];
  const setAns = (v: number) => { const a = [...answers]; a[originalIdx] = v; setAnswers(a); };
  // In retake mode, the answers we care about for "all answered?" are the
  // active subset only. Outside retake, it's all of them.
  const allActiveAnswered = activeList.every(({ originalIdx: oi }) => answers[oi] !== null && answers[oi] !== undefined);
  const totalQs = activeList.length;

  const submit = async () => {
    if (!user || !lesson) return;
    setSubmitting(true);
    const correct = answers.filter((a, i) => a === questions[i].correct).length;
    const pct = Math.round((correct / questions.length) * 100);
    // 100% required.
    const pass = pct === 100;
    await recordAttempt(user.id, lesson.id, answers as number[], correct, questions.length, pass);
    if (pass) {
      // Passing the quiz completes the lesson at the COMPONENT level (video was
      // already watched to unlock the quiz; this passing attempt satisfies the
      // quiz component). The agreement, when required, is a COURSE-level gate
      // handled separately by the course-completion calc and the agreement step
      // below — it must not hold this lesson's own completion hostage.
      await saveLessonProgress(user.id, lesson.id, lesson.duration, true);
    }
    setSubmitting(false);
    setStage('result');
    // After a passing submit, clear retake mode + persisted quiz state — there's
    // nothing useful to restore once the learner has passed. Failed attempts
    // keep the stored answers so the learner can review wrong answers after a
    // refresh and resume the retake of just those questions.
    if (pass) {
      setRetakeIndices(null); // reset retake mode for the next lesson
      if (persistKey) {
        try { localStorage.removeItem(persistKey); } catch { /* ignore */ }
      }
    }
  };

  return (
    <div style={{padding:'24px 40px 48px', maxWidth:1180, animation:'fadeUp .3s'}}>
      <div style={{display:'flex', alignItems:'center', gap:16, marginBottom:20}}>
        <div>
          <div style={{fontSize:11, fontWeight:600, color:'#8A97A8', letterSpacing:'.06em', textTransform:'uppercase'}}>{retakeIndices !== null ? `Retake · ${retakeIndices.length} wrong question${retakeIndices.length === 1 ? '' : 's'}` : `Assessment${courseHasVideo ? ` · Video ${lessonIdx+1} of ${lessons.length}` : ''}`}</div>
          <h2 style={{fontSize:22, color:'#0A1F3D', margin:'4px 0 0', letterSpacing:'-.02em', fontWeight:700}}>{lessonName || course.title}</h2>
        </div>
        <div style={{marginLeft:'auto', display:'flex', gap:10, alignItems:'center'}}>
          <Btn variant="ghost" size="sm" onClick={()=>onNav(courseHasVideo ? 'player' : 'courses')}>Exit</Btn>
        </div>
      </div>

      <div style={{display:'grid', gridTemplateColumns:'1fr 280px', gap:20}}>
        <Card pad={0}>
          <div style={{padding:'18px 26px', borderBottom:'1px solid #EEF2F7', display:'flex', alignItems:'center', gap:14}}>
            <div style={{fontSize:12, fontWeight:700, color:'#8A97A8', letterSpacing:'.06em', textTransform:'uppercase'}}>
              Question {idx+1} of {totalQs}
            </div>
            <div style={{flex:1}}><ProgressBar value={((idx+1)/totalQs)*100} height={4}/></div>
            <button onClick={()=>{ const f = new Set(flagged); f.has(originalIdx) ? f.delete(originalIdx) : f.add(originalIdx); setFlagged(f); }} style={{padding:'5px 11px', background: flagged.has(originalIdx)?'#FEEFD3':'#F7F9FC', color: flagged.has(originalIdx)?'#B8660F':'#5B6A7D', border:0, borderRadius:8, fontSize:12, fontWeight:600, cursor:'pointer'}}>
              {flagged.has(originalIdx) ? 'Flagged' : 'Flag'}
            </button>
          </div>
          <div style={{padding:'26px 30px 22px'}}>
            {q.options.length === 1 ? (
              // Consent/acknowledgment statement — normal weight, each line on
              // its own row with spacing (the lead-in line is lightly emphasised).
              <div style={{display:'flex', flexDirection:'column', gap:12}}>
                {q.q.split('\n').map(l => l.trim()).filter(Boolean).map((line, li) => (
                  <div key={li} style={{fontSize:14, color:'#3B4A5E', lineHeight:1.65, fontWeight: li === 0 ? 600 : 400}}>{line}</div>
                ))}
              </div>
            ) : (
              <h3 style={{fontSize:19, color:'#0A1F3D', letterSpacing:'-.01em', fontWeight:700, lineHeight:1.35, margin:0}}>{q.q}</h3>
            )}
            <div style={{display:'flex', flexDirection:'column', gap:10, marginTop:20}}>
              {q.options.length === 1 ? (
                // Consent/acknowledgment question — a single checkbox to tick.
                (() => {
                  const on = selected === 0;
                  return (
                    <button
                      onClick={() => { const a = [...answers]; a[originalIdx] = on ? null : 0; setAnswers(a); }}
                      style={{display:'flex', gap:14, alignItems:'center', padding:'16px 18px', background: on?'#F0FCF5':'#fff', border:`1.5px solid ${on?'#17A674':'#EEF2F7'}`, borderRadius:10, cursor:'pointer', textAlign:'left', transition:'all .15s'}}
                    >
                      <div style={{flexShrink:0, width:24, height:24, borderRadius:6, border:`2px solid ${on?'#17A674':'#CBD5E1'}`, background: on?'#17A674':'#fff', color:'#fff', display:'grid', placeItems:'center', fontWeight:800, fontSize:14}}>{on ? '✓' : ''}</div>
                      <div style={{fontSize:14, color:'#0A1F3D', lineHeight:1.5, flex:1, fontWeight:600}}>{q.options[0]}</div>
                    </button>
                  );
                })()
              ) : (
                q.options.map((opt, i) => {
                  const on = selected === i;
                  return (
                    <button key={i} onClick={()=>setAns(i)} style={{display:'flex', gap:14, alignItems:'flex-start', padding:'13px 16px', background: on?'#F2F9FF':'#fff', border:`1.5px solid ${on?'#0072FF':'#EEF2F7'}`, borderRadius:10, cursor:'pointer', textAlign:'left', transition:'all .15s'}}>
                      <div style={{flexShrink:0, width:26, height:26, borderRadius:8, background: on?'#0072FF':'#F7F9FC', color: on?'#fff':'#5B6A7D', display:'grid', placeItems:'center', fontWeight:700, fontSize:12}}>{String.fromCharCode(65+i)}</div>
                      <div style={{fontSize:14, color:'#3B4A5E', lineHeight:1.5, flex:1}}>{opt}</div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
          <div style={{padding:'14px 26px', borderTop:'1px solid #EEF2F7', display:'flex', alignItems:'center'}}>
            <Btn variant="ghost" disabled={idx===0} onClick={()=>setIdx(i=>i-1)}>← Previous</Btn>
            <div style={{marginLeft:'auto'}}>
              {idx<totalQs-1
                ? <Btn onClick={()=>setIdx(i=>i+1)} disabled={selected===null || selected === undefined}>Next →</Btn>
                : <Btn variant="success" onClick={submit} disabled={!allActiveAnswered || submitting}>{submitting?'Submitting…':'Submit'}</Btn>}
            </div>
          </div>
        </Card>

        <div>
          <Card pad={16}>
            <div style={{fontSize:11, fontWeight:600, color:'#8A97A8', letterSpacing:'.06em', marginBottom:10, textTransform:'uppercase'}}>Questions</div>
            <div style={{display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:6}}>
              {activeList.map((entry, i) => {
                const oi = entry.originalIdx;
                const answered = answers[oi] !== null && answers[oi] !== undefined;
                const current = i === idx;
                const flag = flagged.has(oi);
                return (
                  <button key={oi} onClick={()=>setIdx(i)} title={`Q${oi+1} from full assessment`} style={{aspectRatio:'1/1', borderRadius:8, border: current?'2px solid #0072FF':'1px solid #EEF2F7', background: flag?'#FEEFD3':answered?'#E6F4FF':'#fff', color: flag?'#B8660F':answered?'#0072FF':'#5B6A7D', fontSize:13, fontWeight:700, cursor:'pointer'}}>{i+1}</button>
                );
              })}
            </div>
            <div style={{marginTop:14, fontSize:12, color:'#5B6A7D', lineHeight:1.6}}>
              <div>Required score: <b style={{color:'#0A1F3D'}}>100%</b></div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
