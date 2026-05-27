import { useState, useEffect, useRef } from "react";
import { useMCQ, useCourseLessons, recordAttempt, saveLessonProgress } from "./queries";
import { useAuth } from "./auth";
import { supabase } from "@/integrations/supabase/client";
import { Btn, Card, Chip, EmptyState } from "./ui";
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

  // 'feedback' stage = first-attempt-only page shown after the last question,
  // before the final submit. Retakes go straight quiz → result.
  const [stage, setStage] = useState<'quiz'|'feedback'|'result'>('quiz');
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<(number|null)[]>([]);
  const [flagged, setFlagged] = useState<Set<number>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  // When non-null, quiz runs in "retake" mode — only the wrong question
  // indices are shown. Correct answers from the previous attempt are kept
  // intact in `answers` so scoring still uses the full array.
  const [retakeIndices, setRetakeIndices] = useState<number[] | null>(null);

  // --- First-attempt signal collection (clarity/confidence) + feedback ---
  // priorAttemptCount: how many attempts already exist for this user+lesson.
  // The genuine first attempt = no prior attempts AND not in a retake.
  const [priorAttemptCount, setPriorAttemptCount] = useState<number | null>(null);
  // Per-question signals, keyed by the question's position in the full set.
  const [signals, setSignals] = useState<Record<number, { unclear: boolean; notConfident: boolean }>>({});
  const [fbRating, setFbRating] = useState(0);   // 0 = unrated
  const [fbText, setFbText] = useState('');
  const startedAtRef = useRef<string>(new Date().toISOString());
  const isFirstAttempt = priorAttemptCount === 0 && retakeIndices === null;

  // Persistence — quiz state survives tab refresh / tab switch.
  // Key per (user, lesson). Cleared on submit so a retake starts fresh.
  const persistKey = user && activeLessonId ? `assessment-state-${user.id}-${activeLessonId}` : null;
  const restoredRef = useRef(false);
  useEffect(() => {
    if (!persistKey || restoredRef.current) return;
    try {
      const raw = localStorage.getItem(persistKey);
      if (raw) {
        const saved = JSON.parse(raw) as { stage?: string; idx?: number; answers?: (number|null)[]; flagged?: number[]; retakeIndices?: number[] | null; signals?: Record<number, { unclear: boolean; notConfident: boolean }> };
        if (saved.stage === 'quiz' || saved.stage === 'result' || saved.stage === 'feedback') setStage(saved.stage);
        if (typeof saved.idx === 'number') setIdx(saved.idx);
        if (Array.isArray(saved.answers)) setAnswers(saved.answers);
        if (Array.isArray(saved.flagged)) setFlagged(new Set(saved.flagged));
        if ('retakeIndices' in saved) setRetakeIndices(saved.retakeIndices ?? null);
        if (saved.signals && typeof saved.signals === 'object') setSignals(saved.signals);
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
        localStorage.setItem(persistKey, JSON.stringify({ stage, idx, answers, flagged: Array.from(flagged), retakeIndices, signals }));
      } catch { /* quota or serialisation failure — ignore */ }
    }, 200);
    return () => clearTimeout(t);
  }, [persistKey, stage, idx, answers, flagged, retakeIndices, signals]);

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

  // Count prior attempts for this lesson — the clarity/confidence signals and
  // the feedback page are shown ONLY on the genuine first attempt.
  useEffect(() => {
    if (!user || !activeLessonId) { setPriorAttemptCount(null); return; }
    supabase.from('quiz_attempts').select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).eq('lesson_id', activeLessonId)
      .then(({ count }) => setPriorAttemptCount(count ?? 0));
  }, [user, activeLessonId]);

  if (!state.course || !state.activeLesson) {
    return <div style={{padding:40}}><EmptyState icon="🧭" title="No assessment selected" sub="Pick a video first." action={<Btn onClick={()=>onNav('courses')}>Back to Home</Btn>}/></div>;
  }
  if (loading || !course || !lesson) {
    return <div style={{padding:40, color:'#5B6A7D', fontSize:13}}>Loading…</div>;
  }
  if (questions.length === 0) {
    return <div style={{padding:40}}><EmptyState icon="📝" title="No quiz for this lesson" sub="Your admin hasn't added questions for this lesson yet." action={<Btn onClick={()=>onNav('courses')}>Back to Home</Btn>}/></div>;
  }

  // Whether this assessment has any video — only used to route "Exit".
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
      <div style={{padding:'24px 40px 28px', maxWidth:1200, margin:'0 auto', animation:'fadeUp .4s'}}>
        <div style={{display:'grid', gridTemplateColumns:'1.25fr 1fr', gap:24, alignItems:'center'}}>
          <Card pad={0} className="quiz-lift" style={{overflow:'hidden'}}>
            <div style={{padding:'28px 36px', background: pass?'linear-gradient(135deg,#0F7C57,#17A674)':'#0A1F3D', color:'#fff'}}>
              <div style={{width:48, height:48, borderRadius:14, background:'rgba(255,255,255,.14)', display:'grid', placeItems:'center', fontSize:24}}>{pass ? '✓' : '!'}</div>
              <div style={{fontSize:11, fontWeight:600, letterSpacing:'.12em', color:pass?'#D9F4E6':'#7FDBFF', marginTop:14, textTransform:'uppercase'}}>{pass?'Passed':'Not yet passed'}</div>
              <div style={{fontSize:54, fontWeight:800, letterSpacing:'-.03em', marginTop:4, lineHeight:1}}>{pct}%</div>
              <div style={{fontSize:13, color:pass?'#D9F4E6':'#C8DDF4', marginTop:6}}>{correct} of {questions.length} correct · {pass ? (nextLesson ? `Next ${courseHasVideo ? 'video' : 'lesson'} unlocked` : 'Course complete') : `${wrongIndices.length} wrong — re-attempt just those questions`}</div>
            </div>
            <div style={{padding:'22px 36px 24px'}}>
              {/* Show only the final result + score; correct answers are intentionally
                  hidden so retake attempts remain a real assessment. */}
              <div style={{display:'flex', gap:16, alignItems:'stretch'}}>
                <div className="quiz-lift" style={{flex:1, padding:'18px 20px', background:'#F7F9FC', borderRadius:10, border:'1px solid #EEF2F7'}}>
                  <div style={{fontSize:11, fontWeight:700, color:'#8A97A8', letterSpacing:'.08em', textTransform:'uppercase'}}>Result</div>
                  <div style={{fontSize: pass ? 22 : 15, fontWeight:800, color: pass?'#17A674':'#D97706', marginTop:6}}>{pass ? 'Passed ✓' : 'Re-attempt required'}</div>
                </div>
                <div className="quiz-lift" style={{flex:1, padding:'18px 20px', background:'#F7F9FC', borderRadius:10, border:'1px solid #EEF2F7'}}>
                  <div style={{fontSize:11, fontWeight:700, color:'#8A97A8', letterSpacing:'.08em', textTransform:'uppercase'}}>Marks</div>
                  <div style={{fontSize:22, fontWeight:800, color:'#0A1F3D', marginTop:6}}>{correct} / {questions.length}</div>
                </div>
                <div className="quiz-lift" style={{flex:1, padding:'18px 20px', background:'#F7F9FC', borderRadius:10, border:'1px solid #EEF2F7'}}>
                  <div style={{fontSize:11, fontWeight:700, color:'#8A97A8', letterSpacing:'.08em', textTransform:'uppercase'}}>Score</div>
                  <div style={{fontSize:22, fontWeight:800, color:'#0A1F3D', marginTop:6}}>{pct}%</div>
                </div>
              </div>
              <div style={{marginTop:18, fontSize:12, color:'#5B6A7D'}}>
                {pass
                  ? 'Great work — your completion is recorded.'
                  : `You answered ${wrongIndices.length} question${wrongIndices.length === 1 ? '' : 's'} incorrectly. Re-attempt just those — every question must be correct to pass.`}
              </div>
            </div>
          </Card>

          {/* Right column — content vertically centred so the action button
              sits mid-page on the right side (not at the very top or bottom). */}
          <div style={{display:'flex', flexDirection:'column', gap:16, justifyContent:'center'}}>
            <Card pad={22} className="quiz-lift">
              <div style={{fontSize:13, fontWeight:700, color:'#0A1F3D', marginBottom:8}}>What happens next</div>
              <div style={{fontSize:13, color:'#3B4A5E', lineHeight:1.6}}>
                {pass
                  ? <>Your score has been recorded. {nextLesson ? <>The next {courseHasVideo ? 'video' : 'lesson'} — <b>{nextLesson.title}</b> — is now unlocked.</> : <>You've completed this course.</>}</>
                  : <>Re-attempt the {wrongIndices.length} wrong question{wrongIndices.length === 1 ? '' : 's'} to pass. Your correct answers are already saved — only the wrong ones will be shown.</>}
              </div>
            </Card>
            {/* Prominent, interactive action (retake pulses). */}
            {pass ? (
              <button className="quiz-action-btn quiz-action-success" style={{width:'100%', justifyContent:'center'}} onClick={onNext}>
                {nextLesson ? <>Start next lesson <span aria-hidden>→</span></> : <>Done <span aria-hidden>→</span></>}
              </button>
            ) : (
              <button className="quiz-action-btn quiz-action-retry" style={{width:'100%', justifyContent:'center'}} onClick={onRetryWrong}>
                <span aria-hidden style={{fontSize:16}}>↻</span> Re-attempt {wrongIndices.length} wrong answer{wrongIndices.length === 1 ? '' : 's'}
              </button>
            )}
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

  const submit = async (feedback?: { rating: number | null; text: string | null; submitted: boolean }) => {
    if (!user || !lesson) return;
    setSubmitting(true);
    const correct = answers.filter((a, i) => a === questions[i].correct).length;
    const pct = Math.round((correct / questions.length) * 100);
    // 100% required.
    const pass = pct === 100;
    // Records the attempt + per-question responses. Signals + feedback are
    // passed only on the first attempt (recordAttempt ignores them otherwise).
    await recordAttempt(user.id, lesson.id, {
      questions: questions.map(q => ({ id: q.id, correct: q.correct })),
      answers,
      score: correct,
      total: questions.length,
      passed: pass,
      isFirstAttempt,
      startedAt: startedAtRef.current,
      signals: isFirstAttempt ? signals : undefined,
      feedback: isFirstAttempt ? feedback : undefined,
    });
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

  // First-attempt-only feedback page — shown after the last question, before
  // the final submit. Both fields optional; collected exactly once.
  if (stage === 'feedback') {
    return (
      <div style={{padding:'28px 40px 48px', maxWidth:640, margin:'0 auto', animation:'fadeUp .3s'}}>
        <Card pad={0} style={{overflow:'hidden'}}>
          <div style={{padding:'24px 30px', background:'linear-gradient(135deg,#0A1F3D,#0072FF)', color:'#fff'}}>
            <div style={{fontSize:11, fontWeight:700, letterSpacing:'.12em', color:'#9EC9F0', textTransform:'uppercase'}}>One quick step</div>
            <div style={{fontSize:20, fontWeight:800, marginTop:4}}>How was this assessment?</div>
            <div style={{fontSize:12.5, color:'#C8DDF4', marginTop:6, lineHeight:1.5}}>Optional — your feedback helps us improve the training. We only ask once.</div>
          </div>
          <div style={{padding:'24px 30px 26px', display:'flex', flexDirection:'column', gap:22}}>
            <div>
              <div style={{fontSize:13, fontWeight:700, color:'#0A1F3D', marginBottom:10}}>Overall rating</div>
              <div style={{display:'flex', gap:8}}>
                {[1,2,3,4,5].map(n => (
                  <button key={n} onClick={()=>setFbRating(n === fbRating ? 0 : n)} title={`${n} star${n===1?'':'s'}`}
                    style={{width:44, height:44, borderRadius:10, border:`1.5px solid ${n<=fbRating?'#E08A1E':'#EEF2F7'}`, background: n<=fbRating?'#FFF8EA':'#fff', fontSize:20, lineHeight:1, cursor:'pointer', color: n<=fbRating?'#E08A1E':'#CBD5E1', transition:'all .12s'}}>★</button>
                ))}
              </div>
            </div>
            <div>
              <div style={{fontSize:13, fontWeight:700, color:'#0A1F3D', marginBottom:10}}>Suggestions / improvements</div>
              <textarea value={fbText} onChange={e=>setFbText(e.target.value)} rows={4} placeholder="Anything unclear, or ideas to improve? (optional)"
                style={{width:'100%', padding:'12px 14px', border:'1px solid #DDE4ED', borderRadius:10, fontSize:14, fontFamily:'inherit', resize:'vertical', outline:'none', boxSizing:'border-box'}}/>
            </div>
            <div style={{display:'flex', gap:10, justifyContent:'flex-end', flexWrap:'wrap'}}>
              <Btn variant="ghost" size="lg" disabled={submitting} onClick={()=>submit({ rating: null, text: null, submitted: false })}>{submitting?'Submitting…':'Skip & Submit'}</Btn>
              <Btn variant="success" size="lg" disabled={submitting} onClick={()=>submit({ rating: fbRating||null, text: fbText.trim()||null, submitted: true })}>{submitting?'Submitting…':'Submit with feedback'}</Btn>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div style={{padding:'24px 40px 48px', maxWidth:1180, animation:'fadeUp .3s'}}>
      <div style={{display:'flex', alignItems:'center', gap:16, marginBottom:20}}>
        <div>
          <div style={{fontSize:11, fontWeight:600, color:'#8A97A8', letterSpacing:'.06em', textTransform:'uppercase'}}>{retakeIndices !== null ? `Retake · ${retakeIndices.length} wrong answer${retakeIndices.length === 1 ? '' : 's'}` : 'Assessment'}</div>
          <h2 style={{fontSize:22, color:'#0A1F3D', margin:'4px 0 0', letterSpacing:'-.02em', fontWeight:700}}>{course.title}</h2>
        </div>
        <div style={{marginLeft:'auto', display:'flex', gap:10, alignItems:'center'}}>
          <Btn variant="ghost" size="sm" onClick={()=>onNav(courseHasVideo ? 'player' : 'courses')}>Exit</Btn>
        </div>
      </div>

      {/* First-attempt only: explain the clarity/confidence signals. */}
      {isFirstAttempt && (
        <div style={{marginBottom:20, padding:'14px 18px', background:'#F2F9FF', border:'1px solid #CCEAFF', borderRadius:12, fontSize:13, color:'#0A1F3D', lineHeight:1.55}}>
          If a question isn't clear, tick <b>"This question wasn't clear to me."</b> If you don't know the concept, tick <b>"I'm not confident about this concept"</b> instead of guessing — this helps us identify where to strengthen training.
        </div>
      )}

      <div style={{display:'grid', gridTemplateColumns:'1fr 280px', gap:20}}>
        <Card pad={0}>
          <div style={{padding:'18px 26px', borderBottom:'1px solid #EEF2F7', display:'flex', alignItems:'center', gap:14}}>
            <div style={{flex:1, fontSize:12, fontWeight:700, color:'#8A97A8', letterSpacing:'.06em', textTransform:'uppercase'}}>
              Question {idx+1} of {totalQs}
            </div>
            <button onClick={()=>{ const f = new Set(flagged); f.has(originalIdx) ? f.delete(originalIdx) : f.add(originalIdx); setFlagged(f); }} style={{padding:'5px 11px', background: flagged.has(originalIdx)?'#FEEFD3':'#F7F9FC', color: flagged.has(originalIdx)?'#B8660F':'#5B6A7D', border:0, borderRadius:8, fontSize:12, fontWeight:600, cursor:'pointer'}}>
              {flagged.has(originalIdx) ? 'Flagged' : 'Flag'}
            </button>
          </div>
          <div style={{padding:'26px 30px 22px'}}>
            {q.options.length === 1 ? (
              // Consent/acknowledgment statement — normal weight, each line on
              // its own row with spacing (the lead-in line is lightly emphasised).
              <div style={{display:'flex', flexDirection:'column', gap:12}}>
                {q.q.split('\n').map(l => l.trim())
                  // Drop the trailing "I have read and agree…" line — it's shown
                  // once next to the checkbox below, so it shouldn't repeat here.
                  .filter(l => l && !/i\s+have\s+read\s+and\s+agree/i.test(l))
                  .map((line, li) => (
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
            {/* First-attempt-only signals — informational, never affect scoring.
                Hidden for the consent question (single option). */}
            {isFirstAttempt && q.options.length > 1 && (() => {
              const sig = signals[originalIdx] || { unclear: false, notConfident: false };
              const toggle = (key: 'unclear' | 'notConfident') =>
                setSignals(prev => ({ ...prev, [originalIdx]: { ...sig, [key]: !sig[key] } }));
              const Box = ({ checked, label, onClick }: { checked: boolean; label: string; onClick: () => void }) => (
                <button onClick={onClick} style={{display:'flex', gap:9, alignItems:'center', padding:'8px 12px', background: checked?'#FFF8EA':'#F7F9FC', border:`1px solid ${checked?'#FCD79B':'#EEF2F7'}`, borderRadius:8, cursor:'pointer', fontSize:12.5, color: checked?'#9A6708':'#5B6A7D', fontWeight:600}}>
                  <span style={{width:16, height:16, borderRadius:4, border:`2px solid ${checked?'#E08A1E':'#CBD5E1'}`, background: checked?'#E08A1E':'#fff', color:'#fff', display:'grid', placeItems:'center', fontSize:11, flexShrink:0}}>{checked ? '✓' : ''}</span>
                  {label}
                </button>
              );
              return (
                <div style={{display:'flex', gap:10, marginTop:16, flexWrap:'wrap'}}>
                  <Box checked={sig.unclear} label="This question wasn't clear to me" onClick={() => toggle('unclear')} />
                  <Box checked={sig.notConfident} label="I'm not confident about this concept" onClick={() => toggle('notConfident')} />
                </div>
              );
            })()}
          </div>
          <div style={{padding:'14px 26px', borderTop:'1px solid #EEF2F7', display:'flex', alignItems:'center'}}>
            <Btn variant="ghost" disabled={idx===0} onClick={()=>setIdx(i=>i-1)}>← Previous</Btn>
            <div style={{marginLeft:'auto'}}>
              {idx<totalQs-1
                ? <Btn onClick={()=>setIdx(i=>i+1)} disabled={selected===null || selected === undefined}>Next →</Btn>
                : isFirstAttempt
                  // First attempt → go to the one-time feedback page before submitting.
                  ? <Btn variant="success" onClick={()=>setStage('feedback')} disabled={!allActiveAnswered || submitting}>Continue →</Btn>
                  // Retake → submit directly (no feedback page).
                  : <Btn variant="success" onClick={()=>submit()} disabled={!allActiveAnswered || submitting}>{submitting?'Submitting…':'Submit'}</Btn>}
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
