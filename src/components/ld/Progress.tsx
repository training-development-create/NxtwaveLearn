import { useEffect, useState } from "react";
import { useUserCourses } from "./queries";
import { useAuth } from "./auth";
import { supabase } from "@/integrations/supabase/client";
import { Card, ProgressBar, EmptyState } from "./ui";

type Stat = { totalAttempts: number; avgScore: number; watchSeconds: number };

export function ProgressPage() {
  const { user } = useAuth();
  const { items: courses, loading } = useUserCourses(user?.id ?? null);
  const [stat, setStat] = useState<Stat>({ totalAttempts: 0, avgScore: 0, watchSeconds: 0 });
  const [bestByCourse, setBestByCourse] = useState<Record<string, number>>({});
  const [lastByCourse, setLastByCourse] = useState<Record<string, string>>({});

  const load = async () => {
    if (!user) return;
    const [{ data: attempts }, { data: prog }, { data: lessons }] = await Promise.all([
      supabase.from('quiz_attempts').select('lesson_id, score, total, created_at').eq('user_id', user.id),
      supabase.from('lesson_progress').select('lesson_id, watched_seconds, updated_at').eq('user_id', user.id),
      supabase.from('lessons').select('id, course_id'),
    ]);
    const lessonToCourse = new Map<string, string>();
    (lessons || []).forEach((l: { id: string; course_id: string }) => lessonToCourse.set(l.id, l.course_id));
    const totalAttempts = (attempts || []).length;
    const sumPct = (attempts || []).reduce((s: number, a: { score: number; total: number }) => s + (a.total ? (a.score/a.total)*100 : 0), 0);
    const avgScore = totalAttempts ? Math.round(sumPct/totalAttempts) : 0;
    const watch = (prog || []).reduce((s: number, p: { watched_seconds: number }) => s + (p.watched_seconds || 0), 0);
    const best: Record<string, number> = {};
    const last: Record<string, string> = {};
    (attempts || []).forEach((a: { lesson_id: string; score: number; total: number; created_at: string }) => {
      const c = lessonToCourse.get(a.lesson_id);
      if (!c) return;
      const pct = a.total ? Math.round((a.score/a.total)*100) : 0;
      best[c] = Math.max(best[c] || 0, pct);
    });
    (prog || []).forEach((p: { lesson_id: string; updated_at: string }) => {
      const c = lessonToCourse.get(p.lesson_id);
      if (!c) return;
      if (!last[c] || p.updated_at > last[c]) last[c] = p.updated_at;
    });
    setStat({ totalAttempts, avgScore, watchSeconds: watch });
    setBestByCourse(best);
    setLastByCourse(last);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user]);

  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel(`progress-page-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lesson_progress', filter: `user_id=eq.${user.id}` }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quiz_attempts', filter: `user_id=eq.${user.id}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const required = courses.filter(c => c.tag === 'Mandatory');
  const completed = courses.filter(c => c.progress === 100);
  const totalHrs = (stat.watchSeconds / 3600).toFixed(1);

  return (
    <div style={{padding:'28px 40px 48px', maxWidth:1100, animation:'fadeUp .3s'}}>
      <div style={{display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:14, marginBottom:28}}>
        <SummaryTile label="Required complete" value={`${required.filter(c=>c.progress===100).length}/${required.length}`} tone="brand"/>
        <SummaryTile label="Courses completed" value={String(completed.length)} tone="default"/>
        <SummaryTile label="Average assessment score" value={stat.totalAttempts ? `${stat.avgScore}%` : '—'} tone="success"/>
        <SummaryTile label="Total watch time" value={`${totalHrs}h`} tone="default"/>
      </div>

      <div style={{fontSize:15, fontWeight:700, color:'#0A1F3D', marginBottom:12, letterSpacing:'-.01em'}}>Course history</div>
      {loading ? (
        <Card pad={24} style={{color:'#5B6A7D', fontSize:13}}>Loading…</Card>
      ) : courses.length === 0 ? (
        <EmptyState icon="📈" title="Nothing to track yet" sub="Once your team publishes courses and you start watching, your history will show up here."/>
      ) : (
        <Card pad={0}>
          <table style={{width:'100%', borderCollapse:'collapse'}}>
            <thead>
              <tr style={{background:'#FAFBFD'}}>
                {['Course','Status','Progress','Best score','Last active'].map(h => (
                  <th key={h} style={{padding:'12px 18px', textAlign:'left', fontSize:11, color:'#8A97A8', fontWeight:600, letterSpacing:'.06em', borderBottom:'1px solid #EEF2F7', textTransform:'uppercase'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {courses.map(c => {
                const score = bestByCourse[c.id] ?? null;
                const last = lastByCourse[c.id];
                const status = c.progress === 100 ? 'Completed' : (c.started || c.progress > 0) ? 'In progress' : 'Assigned';
                const statusColor = status === 'Completed' ? '#17A674' : status === 'In progress' ? '#0072FF' : '#8A97A8';
                const statusBg = status === 'Completed' ? '#E8F7EF' : status === 'In progress' ? '#E6F1FF' : '#F1F4F9';
                return (
                  <tr key={c.id} style={{borderBottom:'1px solid #F7F9FC'}}>
                    <td style={{padding:'14px 18px'}}>
                      <div style={{display:'flex', alignItems:'center', gap:12}}>
                        <div style={{width:34, height:34, borderRadius:9, background:`${c.hue}15`, color:c.hue, display:'grid', placeItems:'center', fontSize:16}}>{c.emoji}</div>
                        <div>
                          <div style={{fontSize:13, fontWeight:700, color:'#0A1F3D'}}>{c.title}</div>
                          <div style={{fontSize:11, color:'#5B6A7D'}}>{c.tag} · {c.lessons_total} videos</div>
                        </div>
                      </div>
                    </td>
                    <td style={{padding:'14px 18px'}}>
                      <span style={{display:'inline-block', padding:'3px 10px', borderRadius:999, fontSize:11, fontWeight:700, color:statusColor, background:statusBg}}>{status}</span>
                    </td>
                    <td style={{padding:'14px 18px', minWidth:180}}><ProgressBar value={c.progress} showLabel height={4}/></td>
                    <td style={{padding:'14px 18px'}}>
                      {score !== null
                        ? <span style={{fontSize:13, fontWeight:700, color: score>=70?'#17A674':'#C2261D'}}>{score}%</span>
                        : <span style={{color:'#8A97A8', fontSize:12}}>—</span>}
                    </td>
                    <td style={{padding:'14px 18px', fontSize:12, color:'#5B6A7D'}}>{last ? new Date(last).toLocaleDateString() : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function SummaryTile({ label, value, tone }: { label:string; value:string; tone:'success'|'brand'|'default' }) {
  const toneFg = tone==='success' ? '#17A674' : tone==='brand' ? '#0072FF' : '#0A1F3D';
  return (
    <div style={{background:'#fff', borderRadius:12, border:'1px solid #EEF2F7', padding:'18px 20px'}}>
      <div style={{fontSize:11, fontWeight:600, color:'#8A97A8', letterSpacing:'.06em', textTransform:'uppercase'}}>{label}</div>
      <div style={{fontSize:28, fontWeight:700, color:toneFg, letterSpacing:'-.02em', marginTop:6, lineHeight:1}}>{value}</div>
    </div>
  );
}
