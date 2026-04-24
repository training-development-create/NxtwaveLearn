import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, Chip, InitialAvatar, Spark, EmptyState } from "./ui";
import type { Nav } from "./App";

type Learner = { id: string; name: string; email: string; completion: number; score: number; status: string; last: string };

export function AdminDashboard({ onNav }: { onNav: Nav }) {
  const [activeLearners, setActiveLearners] = useState(0);
  const [avgScore, setAvgScore] = useState(0);
  const [completionRate, setCompletionRate] = useState(0);
  const [totalAttempts, setTotalAttempts] = useState(0);
  const [scoreDist, setScoreDist] = useState<{ band: string; count: number }[]>([]);
  const [learners, setLearners] = useState<Learner[]>([]);
  const [funnel, setFunnel] = useState<{ step: string; value: number }[]>([]);

  const load = async () => {
    const [{ data: profiles }, { data: enrolls }, { data: prog }, { data: lessons }, { data: attempts }] = await Promise.all([
      supabase.from('profiles').select('id, full_name, email, avatar_url'),
      supabase.from('enrollments').select('user_id, course_id'),
      supabase.from('lesson_progress').select('user_id, lesson_id, watched_seconds, completed, updated_at'),
      supabase.from('lessons').select('id, course_id, duration_seconds'),
      supabase.from('quiz_attempts').select('user_id, lesson_id, score, total, passed, created_at'),
    ]);

    setActiveLearners((profiles || []).length);
    const totalAttemptsCount = (attempts || []).length;
    setTotalAttempts(totalAttemptsCount);
    const sumPct = (attempts || []).reduce((s: number, a: { score: number; total: number }) => s + (a.total ? (a.score/a.total)*100 : 0), 0);
    setAvgScore(totalAttemptsCount ? Math.round(sumPct/totalAttemptsCount) : 0);

    const lessonsByCourse = new Map<string, string[]>();
    const lessonDuration = new Map<string, number>();
    (lessons || []).forEach((l: { id: string; course_id: string; duration_seconds: number }) => {
      const arr = lessonsByCourse.get(l.course_id) || []; arr.push(l.id); lessonsByCourse.set(l.course_id, arr);
      lessonDuration.set(l.id, Math.max(1, Math.round(l.duration_seconds || 0)));
    });
    const doneByUser = new Map<string, Set<string>>();
    (prog || []).filter((p: { completed: boolean }) => p.completed).forEach((p: { user_id: string; lesson_id: string }) => {
      if (!doneByUser.has(p.user_id)) doneByUser.set(p.user_id, new Set());
      doneByUser.get(p.user_id)!.add(p.lesson_id);
    });
    let totalEn = 0, completeEn = 0;
    (enrolls || []).forEach((e: { user_id: string; course_id: string }) => {
      const ids = lessonsByCourse.get(e.course_id) || [];
      if (ids.length === 0) return;
      totalEn++;
      const set = doneByUser.get(e.user_id);
      if (set && ids.every(id => set.has(id))) completeEn++;
    });
    setCompletionRate(totalEn ? Math.round((completeEn/totalEn)*100) : 0);

    const bands = [{ band:'0–40', min:0, max:40 },{ band:'41–60', min:41, max:60 },{ band:'61–75', min:61, max:75 },{ band:'76–90', min:76, max:90 },{ band:'91–100', min:91, max:100 }];
    const dist = bands.map(b => ({ band: b.band, count: 0 }));
    (attempts || []).forEach((a: { score: number; total: number }) => {
      const pct = a.total ? Math.round((a.score/a.total)*100) : 0;
      const i = bands.findIndex(b => pct >= b.min && pct <= b.max);
      if (i >= 0) dist[i].count++;
    });
    setScoreDist(dist);

    const lastByUser = new Map<string, string>();
    (prog || []).forEach((p: { user_id: string; updated_at: string }) => {
      if (!lastByUser.has(p.user_id) || p.updated_at > lastByUser.get(p.user_id)!) lastByUser.set(p.user_id, p.updated_at);
    });
    const completionByUser = new Map<string, number>();
    (profiles || []).forEach((u: { id: string }) => {
      const userEnrolls = (enrolls || []).filter((e: { user_id: string }) => e.user_id === u.id);
      let t = 0, d = 0;
      userEnrolls.forEach((e: { course_id: string }) => {
        const ids = lessonsByCourse.get(e.course_id) || [];
        t += ids.length;
        const set = doneByUser.get(u.id);
        if (set) d += ids.filter(id => set.has(id)).length;
      });
      completionByUser.set(u.id, t ? Math.round((d/t)*100) : 0);
    });
    const scoreByUser = new Map<string, { sum: number; n: number }>();
    (attempts || []).forEach((a: { user_id: string; score: number; total: number }) => {
      const v = scoreByUser.get(a.user_id) || { sum: 0, n: 0 };
      v.sum += a.total ? Math.round((a.score/a.total)*100) : 0; v.n++;
      scoreByUser.set(a.user_id, v);
    });

    const ls: Learner[] = (profiles || []).map((u: { id: string; full_name: string; email: string }) => {
      const c = completionByUser.get(u.id) || 0;
      const s = scoreByUser.get(u.id);
      const score = s && s.n ? Math.round(s.sum/s.n) : 0;
      const lastUpd = lastByUser.get(u.id);
      const status = c >= 70 ? 'active' : c >= 30 ? 'at-risk' : 'overdue';
      return {
        id: u.id, name: u.full_name || u.email, email: u.email,
        completion: c, score, status, last: lastUpd ? new Date(lastUpd).toLocaleDateString() : '—',
      };
    });
    setLearners(ls);

    const enrollPairs = new Set((enrolls || []).map((e: { user_id: string; course_id: string }) => `${e.user_id}|${e.course_id}`));
    const lessonToCourse = new Map((lessons || []).map((l: { id: string; course_id: string }) => [l.id, l.course_id]));
    const startedPairs = new Set<string>();
    const finishedPairs = new Set<string>();
    (prog || []).forEach((p: { user_id: string; lesson_id: string; watched_seconds: number; completed: boolean }) => {
      const c = lessonToCourse.get(p.lesson_id); if (!c) return;
      const watched = Math.max(0, Math.round(p.watched_seconds || 0));
      if (watched > 0) startedPairs.add(`${p.user_id}|${c}`);
      const runtime = lessonDuration.get(p.lesson_id) || 1;
      const finishedVideo = p.completed || watched >= Math.ceil(runtime * 0.9);
      if (finishedVideo) finishedPairs.add(`${p.user_id}|${c}`);
    });
    const tookPairs = new Set<string>();
    const passedPairs = new Set<string>();
    (attempts || []).forEach((a: { user_id: string; lesson_id: string; passed: boolean }) => {
      const c = lessonToCourse.get(a.lesson_id); if (!c) return;
      tookPairs.add(`${a.user_id}|${c}`);
      if (a.passed) passedPairs.add(`${a.user_id}|${c}`);
    });
    setFunnel([
      { step: 'Assigned', value: enrollPairs.size },
      { step: 'Started video', value: startedPairs.size },
      { step: 'Finished video', value: finishedPairs.size },
      { step: 'Took assessment', value: tookPairs.size },
      { step: 'Passed (≥70%)', value: passedPairs.size },
    ]);
  };

  useEffect(() => { load(); }, []);

  // Live updates: refetch dashboard whenever progress / attempts / enrollments change.
  useEffect(() => {
    const ch = supabase
      .channel('admin-dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lesson_progress' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quiz_attempts' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'enrollments' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  // Fallback polling keeps admin KPIs fresh even if realtime delivery is delayed.
  useEffect(() => {
    const id = setInterval(() => load(), 5000);
    return () => clearInterval(id);
  }, []);

  const empty = activeLearners === 0 && totalAttempts === 0;

  return (
    <div style={{padding:'28px 36px 48px', animation:'fadeUp .3s'}}>
      <div style={{display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:16, marginBottom:20}}>
        <KPI label="Active learners" value={String(activeLearners)} sub={activeLearners ? 'enrolled accounts' : 'no users yet'} c="#0072FF" spark={[activeLearners]}/>
        <KPI label="Completion rate" value={`${completionRate}%`} sub="across enrollments" c="#E08A1E" spark={[completionRate]}/>
      </div>

      {empty ? (
        <EmptyState icon="📊" title="No activity yet" sub="Once learners sign up and start completing courses, your platform health will populate here."/>
      ) : (
        <>
          <div style={{marginBottom:20}}>
            <Card pad={0}>
              <div style={{padding:'18px 22px', display:'flex', alignItems:'center', borderBottom:'1px solid #EEF2F7'}}>
                <div>
                  <div className="eyebrow" style={{color:'#17A674'}}>🏆 TOP PERFORMERS</div>
                  <div style={{fontSize:16, fontWeight:800, color:'#002A4B', marginTop:2}}>Ranked by completion & assessment scores</div>
                </div>
              </div>
              {(() => {
                const ranked = [...learners]
                  .map(l => ({ ...l, combined: Math.round(l.completion * 0.5 + l.score * 0.5) }))
                  .filter(l => l.completion > 0 || l.score > 0)
                  .sort((a, b) => b.combined - a.combined || b.completion - a.completion || b.score - a.score)
                  .slice(0, 5);
                if (ranked.length === 0) return <div style={{padding:'24px', fontSize:13, color:'#8A97A8', textAlign:'center'}}>No learner activity yet.</div>;
                return ranked.map((l, i) => (
                  <div key={l.id} style={{padding:'12px 22px', display:'flex', alignItems:'center', gap:12, borderBottom:'1px solid #F7F9FC'}}>
                    <div style={{width:24, fontSize:13, fontWeight:800, color:'#8A97A8', textAlign:'center'}}>{i+1}</div>
                    <InitialAvatar name={l.name} size={36}/>
                    <div style={{flex:1}}>
                      <div style={{fontSize:13, fontWeight:700, color:'#002A4B'}}>{l.name}</div>
                      <div style={{fontSize:11, color:'#5B6A7D'}}>{l.email}</div>
                    </div>
                    <div style={{display:'flex', gap:18, alignItems:'center'}}>
                      <div style={{textAlign:'right'}}>
                        <div style={{fontSize:10, color:'#8A97A8', fontWeight:700, letterSpacing:'.06em'}}>COMPLETION</div>
                        <div style={{fontSize:14, fontWeight:800, color:'#0072FF'}}>{l.completion}%</div>
                      </div>
                      <div style={{textAlign:'right'}}>
                        <div style={{fontSize:10, color:'#8A97A8', fontWeight:700, letterSpacing:'.06em'}}>AVG SCORE</div>
                        <div style={{fontSize:14, fontWeight:800, color:'#17A674'}}>{l.score}%</div>
                      </div>
                    </div>
                  </div>
                ));
              })()}
            </Card>
          </div>

          <Card pad={24}>
            <div style={{display:'flex', alignItems:'center', marginBottom:16}}>
              <div>
                <div className="eyebrow">PROGRESS FUNNEL</div>
                <div style={{fontSize:18, fontWeight:800, color:'#002A4B', marginTop:4}}>Assigned → Passed quiz</div>
              </div>
              <a style={{marginLeft:'auto', fontSize:13, cursor:'pointer'}} onClick={()=>onNav('admin-analytics')}>Deep dive →</a>
            </div>
            <div style={{display:'flex', flexDirection:'column', gap:6}}>
              {funnel.map((f,i) => {
                const pct = funnel[0].value ? (f.value/funnel[0].value)*100 : 0;
                const drop = i>0 && funnel[i-1].value ? Math.round(((funnel[i-1].value - f.value)/funnel[i-1].value)*100) : 0;
                return (
                  <div key={f.step} style={{display:'grid', gridTemplateColumns:'160px 1fr 120px', alignItems:'center', gap:16}}>
                    <div style={{fontSize:13, fontWeight:600, color:'#3B4A5E'}}>{f.step}</div>
                    <div style={{height:32, background:'#F7F9FC', borderRadius:8, position:'relative', overflow:'hidden'}}>
                      <div style={{width:`${Math.max(pct,4)}%`, height:'100%', background: `linear-gradient(90deg, hsl(${210-i*8},90%,${60-i*3}%), hsl(${210-i*8},90%,${50-i*3}%))`, borderRadius:8, display:'flex', alignItems:'center', padding:'0 12px', color:'#fff', fontSize:12, fontWeight:700}}>
                        {f.value.toLocaleString()}
                      </div>
                    </div>
                    <div style={{fontSize:12, color: drop>10?'#C2261D':'#5B6A7D', textAlign:'right', fontWeight:600}}>{i>0 ? `-${drop}% drop` : '100%'}</div>
                  </div>
                );
              })}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function KPI({ label, value, sub, spark, c }: { label:string; value:string; sub:string; spark:number[]; c:string }) {
  return (
    <Card pad={18}>
      <div className="eyebrow" style={{color:'#8A97A8'}}>{label.toUpperCase()}</div>
      <div style={{display:'flex', alignItems:'flex-end', justifyContent:'space-between', marginTop:8}}>
        <div>
          <div style={{fontSize:28, fontWeight:900, color:'#002A4B', letterSpacing:'-.02em'}}>{value}</div>
          <div style={{fontSize:12, color:'#8A97A8', fontWeight:600}}>{sub}</div>
        </div>
        <Spark values={spark.length>1 ? spark : [0, ...spark]} color={c} h={40} w={100}/>
      </div>
      <Chip color={c} style={{marginTop:6, fontSize:10}}>live</Chip>
    </Card>
  );
}
