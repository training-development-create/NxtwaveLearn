import { useState, useEffect } from "react";
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

  const [stage, setStage] = useState<'intro'|'quiz'|'result'>('intro');
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<(number|null)[]>([]);
  const [flagged, setFlagged] = useState<Set<number>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { if (questions.length) setAnswers(Array(questions.length).fill(null)); }, [questions.length]);
  useEffect(() => {
    if (!state.course) return;
    supabase.from('courses').select('id, title').eq('id', state.course).maybeSingle().then(({ data }) => setCourse(data));
  }, [state.course]);

  if (!state.course || !state.activeLesson) {
    return <div style={{padding:40}}><EmptyState icon="🧭" title="No quiz selected" sub="Pick a video first." action={<Btn onClick={()=>onNav('courses')}>Back to courses</Btn>}/></div>;
  }
  if (loading || !course || !lesson) {
    return <div style={{padding:40, color:'#5B6A7D', fontSize:13}}>Loading…</div>;
  }
  if (questions.length === 0) {
    return <div style={{padding:40}}><EmptyState icon="📝" title="No quiz for this video" sub="Your L&D admin hasn't added questions for this lesson yet." action={<Btn onClick={()=>onNav('player')}>Back to video</Btn>}/></div>;
  }

  if (stage === 'intro') {
    return (
      <div style={{padding:'28px 40px', maxWidth:860, animation:'fadeUp .3s'}}>
        <Card pad={0} style={{overflow:'hidden'}}>
          <div style={{padding:'36px 40px', background:'#0A1F3D', color:'#fff', position:'relative', overflow:'hidden'}}>
            <div style={{position:'absolute', top:-60, right:-60, width:240, height:240, borderRadius:999, background:'#0072FF', opacity:.22, filter:'blur(70px)'}}/>
            <div style={{position:'relative'}}>
              <div style={{fontSize:11, fontWeight:600, letterSpacing:'.12em', color:'#7FDBFF', textTransform:'uppercase'}}>Assessment · {course.title}</div>
              <h2 style={{fontSize:30, color:'#fff', margin:'10px 0 8px', letterSpacing:'-.02em', fontWeight:700}}>{lesson.title}</h2>
              <p style={{color:'#9EC9F0', fontSize:14, margin:0, lineHeight:1.55, maxWidth:540}}>Answer {questions.length} quick questions to confirm you've understood this video. Pass (70%) to unlock the next one.</p>
            </div>
          </div>
          <div style={{padding:'24px 40px', display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:20, borderBottom:'1px solid #EEF2F7'}}>
            {[[String(questions.length),'Questions'],['70%','Passing score'],['∞','Attempts allowed']].map(([k,v]) => (
              <div key={v}>
                <div style={{fontSize:22, fontWeight:700, color:'#0A1F3D', letterSpacing:'-.02em'}}>{k}</div>
                <div style={{fontSize:12, color:'#5B6A7D', marginTop:2}}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{padding:'22px 40px 28px'}}>
            <ul style={{margin:0, padding:0, listStyle:'none', display:'flex', flexDirection:'column', gap:8, fontSize:13, color:'#3B4A5E'}}>
              {['You can flag questions and come back','Navigate freely between questions','Results are shared with your L&D admin','Failing requires rewatching the video before you can retry'].map(s => (
                <li key={s} style={{display:'flex', gap:10}}><span style={{color:'#17A674'}}>✓</span>{s}</li>
              ))}
            </ul>
            <div style={{marginTop:22, display:'flex', gap:10}}>
              <Btn size="lg" onClick={()=>setStage('quiz')}>Start quiz →</Btn>
              <Btn variant="ghost" size="lg" onClick={()=>onNav('player')}>Back to video</Btn>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  if (stage === 'result') {
    const correct = answers.filter((a,i) => a === questions[i].correct).length;
    const pct = Math.round((correct / questions.length) * 100);
    const pass = pct >= 70;
    const onRetry = () => { setAnswers(Array(questions.length).fill(null)); setIdx(0); setStage('quiz'); };
    const onNext = () => { if (nextLesson) { setState({ ...state, activeLesson: nextLesson.id }); onNav('player'); } else onNav('courses'); };
    return (
      <div style={{padding:'28px 40px 48px', maxWidth:1080, animation:'fadeUp .4s'}}>
        <div style={{display:'grid', gridTemplateColumns:'1.2fr 1fr', gap:20}}>
          <Card pad={0} style={{overflow:'hidden'}}>
            <div style={{padding:'36px 40px', background: pass?'linear-gradient(135deg,#0F7C57,#17A674)':'#0A1F3D', color:'#fff'}}>
              <div style={{width:52, height:52, borderRadius:14, background:'rgba(255,255,255,.14)', display:'grid', placeItems:'center', fontSize:24}}>{pass ? '✓' : '!'}</div>
              <div style={{fontSize:11, fontWeight:600, letterSpacing:'.12em', color:pass?'#D9F4E6':'#7FDBFF', marginTop:18, textTransform:'uppercase'}}>{pass?'Passed':'Not yet passed'}</div>
              <div style={{fontSize:48, fontWeight:700, letterSpacing:'-.03em', marginTop:4, lineHeight:1}}>{pct}%</div>
              <div style={{fontSize:13, color:pass?'#D9F4E6':'#C8DDF4', marginTop:6}}>{correct} of {questions.length} correct · {pass ? (nextLesson ? 'Next video unlocked' : 'Course complete') : '70% needed to pass'}</div>
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
                Correct answers are not displayed. {pass ? 'Great work — your completion is recorded.' : 'Rewatch the video and retry to improve your score.'}
              </div>
              <div style={{marginTop:22, display:'flex', gap:10}}>
                {pass
                  ? <Btn size="lg" onClick={onNext}>{nextLesson ? 'Start next video →' : 'Back to courses →'}</Btn>
                  : <Btn size="lg" onClick={onRetry}>Retry quiz</Btn>}
                <Btn variant="ghost" size="lg" onClick={()=>onNav('courses')}>Back to courses</Btn>
              </div>
            </div>
          </Card>

          <div style={{display:'flex', flexDirection:'column', gap:14}}>
            <Card pad={22}>
              <div style={{fontSize:13, fontWeight:700, color:'#0A1F3D', marginBottom:8}}>What happens next</div>
              <div style={{fontSize:13, color:'#3B4A5E', lineHeight:1.6}}>
                {pass
                  ? <>Your score has been recorded. {nextLesson ? <>The next video — <b>{nextLesson.title}</b> — is now unlocked.</> : <>You've completed every video in this course.</>}</>
                  : <>Rewatch the video, then try again.</>}
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

  const q = questions[idx];
  const selected = answers[idx];
  const setAns = (v: number) => { const a = [...answers]; a[idx] = v; setAnswers(a); };

  const submit = async () => {
    if (!user || !lesson) return;
    setSubmitting(true);
    const correct = answers.filter((a, i) => a === questions[i].correct).length;
    const pct = Math.round((correct / questions.length) * 100);
    const pass = pct >= 70;
    await recordAttempt(user.id, lesson.id, answers as number[], correct, questions.length, pass);
    // Mark the lesson as completed ONLY when the learner passes the quiz.
    if (pass) {
      await saveLessonProgress(user.id, lesson.id, lesson.duration, true);
    }
    setSubmitting(false);
    setStage('result');
  };

  return (
    <div style={{padding:'24px 40px 48px', maxWidth:1180, animation:'fadeUp .3s'}}>
      <div style={{display:'flex', alignItems:'center', gap:16, marginBottom:20}}>
        <div>
          <div style={{fontSize:11, fontWeight:600, color:'#8A97A8', letterSpacing:'.06em', textTransform:'uppercase'}}>Quiz · Video {lessonIdx+1} of {lessons.length}</div>
          <h2 style={{fontSize:22, color:'#0A1F3D', margin:'4px 0 0', letterSpacing:'-.02em', fontWeight:700}}>{lesson.title}</h2>
        </div>
        <div style={{marginLeft:'auto', display:'flex', gap:10, alignItems:'center'}}>
          <Btn variant="ghost" size="sm" onClick={()=>onNav('player')}>Exit</Btn>
        </div>
      </div>

      <div style={{display:'grid', gridTemplateColumns:'1fr 280px', gap:20}}>
        <Card pad={0}>
          <div style={{padding:'18px 26px', borderBottom:'1px solid #EEF2F7', display:'flex', alignItems:'center', gap:14}}>
            <div style={{fontSize:12, fontWeight:700, color:'#8A97A8', letterSpacing:'.06em', textTransform:'uppercase'}}>Question {idx+1} of {questions.length}</div>
            <div style={{flex:1}}><ProgressBar value={((idx+1)/questions.length)*100} height={4}/></div>
            <button onClick={()=>{ const f = new Set(flagged); f.has(idx) ? f.delete(idx) : f.add(idx); setFlagged(f); }} style={{padding:'5px 11px', background: flagged.has(idx)?'#FEEFD3':'#F7F9FC', color: flagged.has(idx)?'#B8660F':'#5B6A7D', border:0, borderRadius:8, fontSize:12, fontWeight:600, cursor:'pointer'}}>
              {flagged.has(idx) ? 'Flagged' : 'Flag'}
            </button>
          </div>
          <div style={{padding:'26px 30px 22px'}}>
            <h3 style={{fontSize:19, color:'#0A1F3D', letterSpacing:'-.01em', fontWeight:700, lineHeight:1.35, margin:0}}>{q.q}</h3>
            <div style={{display:'flex', flexDirection:'column', gap:10, marginTop:20}}>
              {q.options.map((opt, i) => {
                const on = selected === i;
                return (
                  <button key={i} onClick={()=>setAns(i)} style={{display:'flex', gap:14, alignItems:'flex-start', padding:'13px 16px', background: on?'#F2F9FF':'#fff', border:`1.5px solid ${on?'#0072FF':'#EEF2F7'}`, borderRadius:10, cursor:'pointer', textAlign:'left', transition:'all .15s'}}>
                    <div style={{flexShrink:0, width:26, height:26, borderRadius:8, background: on?'#0072FF':'#F7F9FC', color: on?'#fff':'#5B6A7D', display:'grid', placeItems:'center', fontWeight:700, fontSize:12}}>{String.fromCharCode(65+i)}</div>
                    <div style={{fontSize:14, color:'#3B4A5E', lineHeight:1.5, flex:1}}>{opt}</div>
                  </button>
                );
              })}
            </div>
          </div>
          <div style={{padding:'14px 26px', borderTop:'1px solid #EEF2F7', display:'flex', alignItems:'center'}}>
            <Btn variant="ghost" disabled={idx===0} onClick={()=>setIdx(i=>i-1)}>← Previous</Btn>
            <div style={{marginLeft:'auto'}}>
              {idx<questions.length-1
                ? <Btn onClick={()=>setIdx(i=>i+1)} disabled={selected===null}>Next →</Btn>
                : <Btn variant="success" onClick={submit} disabled={answers.some(a=>a===null) || submitting}>{submitting?'Submitting…':'Submit'}</Btn>}
            </div>
          </div>
        </Card>

        <div>
          <Card pad={16}>
            <div style={{fontSize:11, fontWeight:600, color:'#8A97A8', letterSpacing:'.06em', marginBottom:10, textTransform:'uppercase'}}>Questions</div>
            <div style={{display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:6}}>
              {questions.map((_, i) => {
                const answered = answers[i] !== null && answers[i] !== undefined;
                const current = i === idx;
                const flag = flagged.has(i);
                return (
                  <button key={i} onClick={()=>setIdx(i)} style={{aspectRatio:'1/1', borderRadius:8, border: current?'2px solid #0072FF':'1px solid #EEF2F7', background: flag?'#FEEFD3':answered?'#E6F4FF':'#fff', color: flag?'#B8660F':answered?'#0072FF':'#5B6A7D', fontSize:13, fontWeight:700, cursor:'pointer'}}>{i+1}</button>
                );
              })}
            </div>
            <div style={{marginTop:14, fontSize:12, color:'#5B6A7D', lineHeight:1.6}}>
              <div>Passing score: <b style={{color:'#0A1F3D'}}>70%</b></div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
