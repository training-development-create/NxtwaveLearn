import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Btn, Card, Chip, ProgressBar, Avatar, EmptyState } from "./ui";
import { fmt } from "./data";

type CourseRow = { id: string; title: string };
type LessonRow = { id: string; title: string; course_id: string; duration_seconds: number };
type LearnerRow = {
  id: string; name: string; email: string; empId: string;
  watchSec: number; watchPct: number;       // total watched seconds across this course's lessons / total runtime
  completion: number; score: number; attempts: number; status: string;
};
type LessonWatch = { id: string; title: string; avgPct: number; doneCount: number; totalSec: number };

export function AdminAnalytics() {
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [lessons, setLessons] = useState<LessonRow[]>([]);
  const [course, setCourse] = useState<string>('');
  const [vid, setVid] = useState<string>('');
  const [kpi, setKpi] = useState({ enrolled: 0, watchPct: 0, completion: 0, passRate: 0, totalWatchSec: 0 });
  const [lessonWatch, setLessonWatch] = useState<LessonWatch[]>([]);
  const [learners, setLearners] = useState<LearnerRow[]>([]);
  const [retention, setRetention] = useState<{ id: string; title: string; pct: number }[]>([]);
  const [search, setSearch] = useState('');
  const [detailUser, setDetailUser] = useState<LearnerRow | null>(null);

  useEffect(() => {
    (async () => {
      const [{ data: cs }, { data: ls }] = await Promise.all([
        supabase.from('courses').select('id, title').order('created_at', { ascending: true }),
        supabase.from('lessons').select('id, title, course_id, duration_seconds').order('position', { ascending: true }),
      ]);
      setCourses(cs || []);
      setLessons(ls || []);
      if ((cs || []).length && !course) setCourse(cs![0].id);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const courseLessons = lessons.filter(l => l.course_id === course);
  useEffect(() => { if (courseLessons.length) setVid(courseLessons[0].id); else setVid(''); /* eslint-disable-next-line */ }, [course, lessons.length]);

  const loadStats = async () => {
    if (!course) return;
    const lessonsForCourse = lessons.filter(l => l.course_id === course);
    const lessonIds = lessonsForCourse.map(l => l.id);
    const totalRuntime = lessonsForCourse.reduce((s, l) => s + (l.duration_seconds || 0), 0);

    const [{ data: enrolls }, { data: prog }, { data: attempts }, { data: profiles }] = await Promise.all([
      supabase.from('enrollments').select('user_id').eq('course_id', course),
      lessonIds.length ? supabase.from('lesson_progress').select('user_id, lesson_id, watched_seconds, completed').in('lesson_id', lessonIds) : Promise.resolve({ data: [] as { user_id: string; lesson_id: string; watched_seconds: number; completed: boolean }[] }),
      lessonIds.length ? supabase.from('quiz_attempts').select('user_id, lesson_id, score, total, passed').in('lesson_id', lessonIds) : Promise.resolve({ data: [] as { user_id: string; lesson_id: string; score: number; total: number; passed: boolean }[] }),
      supabase.from('profiles').select('id, full_name, email, employee_id'),
    ]);
    const enrolledIds = new Set((enrolls || []).map((e: { user_id: string }) => e.user_id));
    const progArr = (prog || []) as { user_id: string; lesson_id: string; watched_seconds: number; completed: boolean }[];
    const attArr = (attempts || []) as { user_id: string; lesson_id: string; score: number; total: number; passed: boolean }[];

    const totalWatchSec = progArr.reduce((s, p) => s + (p.watched_seconds || 0), 0);
    const denom = (totalRuntime || 1) * (enrolledIds.size || 1);
    setKpi({
      enrolled: enrolledIds.size,
      totalWatchSec,
      watchPct: enrolledIds.size && totalRuntime ? Math.min(100, Math.round((totalWatchSec / denom) * 100)) : 0,
      completion: enrolledIds.size && lessonIds.length
        ? Math.round((Array.from(enrolledIds).filter(uid => lessonIds.every(lid => progArr.some(p => p.user_id === uid && p.lesson_id === lid && p.completed))).length / enrolledIds.size) * 100)
        : 0,
      passRate: attArr.length ? Math.round((attArr.filter(a => a.passed).length / attArr.length) * 100) : 0,
    });

    setRetention(lessonsForCourse.map(l => {
      if (!enrolledIds.size) return { id: l.id, title: l.title, pct: 0 };
      const done = progArr.filter(p => p.lesson_id === l.id && p.completed && enrolledIds.has(p.user_id)).length;
      return { id: l.id, title: l.title, pct: Math.round((done / enrolledIds.size) * 100) };
    }));

    setLessonWatch(lessonsForCourse.map(l => {
      const rows = progArr.filter(p => p.lesson_id === l.id && enrolledIds.has(p.user_id));
      const totalSec = rows.reduce((s, p) => s + (p.watched_seconds || 0), 0);
      const avgPct = enrolledIds.size && l.duration_seconds
        ? Math.min(100, Math.round((totalSec / (l.duration_seconds * enrolledIds.size)) * 100))
        : 0;
      const doneCount = rows.filter(p => p.completed).length;
      return { id: l.id, title: l.title, avgPct, doneCount, totalSec };
    }));

    const profById = new Map(((profiles || []) as { id: string; full_name: string; email: string; employee_id: string | null }[]).map(p => [p.id, p]));
    const rows: LearnerRow[] = Array.from(enrolledIds).map(uid => {
      const u = profById.get(uid);
      if (!u) return null;
      const userProg = progArr.filter(p => p.user_id === uid);
      const userAtt = attArr.filter(a => a.user_id === uid);
      const watchSec = userProg.reduce((s, p) => s + (p.watched_seconds || 0), 0);
      const watchPct = totalRuntime ? Math.min(100, Math.round((watchSec / totalRuntime) * 100)) : 0;
      const completion = lessonIds.length ? Math.round((userProg.filter(p => p.completed).length / lessonIds.length) * 100) : 0;
      const score = userAtt.length ? Math.round(userAtt.reduce((s, a) => s + (a.total ? (a.score/a.total)*100 : 0), 0) / userAtt.length) : 0;
      const status = completion >= 70 ? 'active' : completion >= 30 ? 'at-risk' : 'overdue';
      return {
        id: uid, name: u.full_name || u.email, email: u.email, empId: u.employee_id || '—',
        watchSec, watchPct, completion, score, attempts: userAtt.length, status,
      };
    }).filter(Boolean) as LearnerRow[];
    rows.sort((a, b) => b.watchSec - a.watchSec);
    setLearners(rows);
  };

  useEffect(() => { loadStats(); /* eslint-disable-next-line */ }, [course, lessons]);

  // Live updates: refetch when watch progress / quiz attempts / enrollments change.
  useEffect(() => {
    if (!course) return;
    const ch = supabase
      .channel(`admin-analytics-${course}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lesson_progress' }, () => loadStats())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quiz_attempts' }, () => loadStats())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'enrollments' }, () => loadStats())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course, lessons]);

  // Fallback polling ensures analytics updates even if realtime misses events.
  useEffect(() => {
    if (!course) return;
    const id = setInterval(() => loadStats(), 5000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course, lessons]);

  const filtered = learners.filter(l => !search || l.name.toLowerCase().includes(search.toLowerCase()) || l.empId.toLowerCase().includes(search.toLowerCase()) || l.email.toLowerCase().includes(search.toLowerCase()));

  if (courses.length === 0) {
    return <div style={{padding:36}}><EmptyState icon="📊" title="No courses to analyze" sub="Once you publish a course in Upload & Quiz, analytics will start tracking it."/></div>;
  }

  // Per-video drill-down
  const selectedLesson = courseLessons.find(l => l.id === vid);

  return (
    <div style={{padding:'28px 36px 48px', animation:'fadeUp .3s'}}>
      <div style={{display:'flex', gap:10, marginBottom:20, alignItems:'center', flexWrap:'wrap'}}>
        <select value={course} onChange={e=>setCourse(e.target.value)} style={{padding:'10px 14px', border:'1px solid #DDE4ED', borderRadius:10, fontSize:13, background:'#fff', minWidth:280, fontWeight:600}}>
          {courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
        {courseLessons.length > 0 && (
          <select value={vid} onChange={e=>setVid(e.target.value)} style={{padding:'10px 14px', border:'1px solid #DDE4ED', borderRadius:10, fontSize:13, background:'#fff', minWidth:300, fontWeight:600}}>
            {courseLessons.map(l => <option key={l.id} value={l.id}>{l.title}</option>)}
          </select>
        )}
      </div>

      <div style={{display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:16, marginBottom:20}}>
        <Tile label="Enrolled" v={String(kpi.enrolled)} sub="learners assigned" c="#0072FF"/>
        <Tile label="Completion" v={`${kpi.completion}%`} sub="finished all videos" c="#E08A1E"/>
      </div>

      {selectedLesson && (
        <Card pad={0} style={{marginBottom:20}}>
          <div style={{padding:'18px 22px', borderBottom:'1px solid #EEF2F7'}}>
            <div className="eyebrow">▶ PER-LEARNER WATCH FOR THIS VIDEO</div>
            <div style={{fontSize:16, fontWeight:800, color:'#002A4B', marginTop:2}}>{selectedLesson.title} · runtime {fmt(selectedLesson.duration_seconds)}</div>
          </div>
          <PerLessonWatch lessonId={selectedLesson.id} runtime={selectedLesson.duration_seconds} courseId={course}/>
        </Card>
      )}

      <Card pad={0}>
        <div style={{padding:'18px 22px', display:'flex', alignItems:'center', borderBottom:'1px solid #EEF2F7'}}>
          <div>
            <div className="eyebrow">EMPLOYEE-LEVEL DETAIL</div>
            <div style={{fontSize:16, fontWeight:800, color:'#002A4B', marginTop:2}}>{learners.length} enrolled · showing {filtered.length}</div>
          </div>
          <div style={{marginLeft:'auto', display:'flex', gap:8}}>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search employee, ID or email…" style={{padding:'8px 12px', border:'1px solid #DDE4ED', borderRadius:8, fontSize:12, minWidth:240}}/>
          </div>
        </div>
        {learners.length === 0 ? (
          <div style={{padding:36}}><EmptyState icon="👥" title="No enrollments yet" sub="Once learners self-enroll or start this course, they'll appear here."/></div>
        ) : (
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%', borderCollapse:'collapse', minWidth:900}}>
              <thead>
                <tr style={{background:'#F7F9FC'}}>
                  {['Employee','Emp ID','Watch time','Watch %','Completion','Quiz score','Attempts','Status'].map(h => (
                    <th key={h} style={{padding:'12px 16px', textAlign:'left', fontSize:10, color:'#8A97A8', fontWeight:700, letterSpacing:'.08em', borderBottom:'1px solid #EEF2F7', whiteSpace:'nowrap'}}>{h.toUpperCase()}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(l => (
                  <tr key={l.id} onClick={()=>setDetailUser(l)} style={{borderBottom:'1px solid #F7F9FC', cursor:'pointer'}}>
                    <td style={{padding:'12px 16px'}}>
                      <div style={{display:'flex', alignItems:'center', gap:10}}>
                        <Avatar name={l.name} size={30}/>
                        <div>
                          <div style={{fontSize:13, fontWeight:600, color:'#0072FF', textDecoration:'underline'}}>{l.name}</div>
                          <div style={{fontSize:11, color:'#5B6A7D'}}>{l.email}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{padding:'12px 16px'}}>
                      <code style={{fontSize:12, background:'#F7F9FC', padding:'3px 8px', borderRadius:6, color:'#0072FF', fontWeight:700}}>{l.empId}</code>
                    </td>
                    <td style={{padding:'12px 16px', fontSize:13, fontWeight:700, color:'#002A4B'}}>{fmt(l.watchSec)}</td>
                    <td style={{padding:'12px 16px', minWidth:160}}><ProgressBar value={l.watchPct} showLabel/></td>
                    <td style={{padding:'12px 16px', minWidth:160}}><ProgressBar value={l.completion} showLabel/></td>
                    <td style={{padding:'12px 16px'}}>
                      <Chip color={l.score>=85?'#17A674':l.score>=70?'#E08A1E':l.score>0?'#C2261D':'#8A97A8'}>{l.score>0?`${l.score}%`:'—'}</Chip>
                    </td>
                    <td style={{padding:'12px 16px', fontSize:13, color:'#3B4A5E'}}>{l.attempts}</td>
                    <td style={{padding:'12px 16px'}}>
                      <Chip color={l.status==='active'?'#17A674':l.status==='at-risk'?'#E08A1E':'#C2261D'}>{l.status}</Chip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {detailUser && <EmployeeDetailModal user={detailUser} onClose={()=>setDetailUser(null)}/>}
    </div>
  );
}

function EmployeeDetailModal({ user, onClose }: { user: LearnerRow; onClose: () => void }) {
  type CourseDetail = {
    id: string; title: string; emoji: string; enrolled: boolean;
    totalRuntime: number; totalWatched: number; lessonsTotal: number; lessonsCompleted: number;
    avgScore: number; status: 'completed' | 'in-progress' | 'not-started';
    lessons: { id: string; title: string; runtime: number; watched: number; pct: number; completed: boolean; bestScore: number }[];
  };
  const [details, setDetails] = useState<CourseDetail[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [{ data: courses }, { data: lessons }, { data: enrolls }, { data: progress }, { data: attempts }] = await Promise.all([
        supabase.from('courses').select('id, title, emoji').order('created_at', { ascending: true }),
        supabase.from('lessons').select('id, course_id, title, duration_seconds, position').order('position', { ascending: true }),
        supabase.from('enrollments').select('course_id').eq('user_id', user.id),
        supabase.from('lesson_progress').select('lesson_id, watched_seconds, completed').eq('user_id', user.id),
        supabase.from('quiz_attempts').select('lesson_id, score, total, passed').eq('user_id', user.id),
      ]);
      const enrolledIds = new Set((enrolls || []).map((e: { course_id: string }) => e.course_id));
      const progByLesson = new Map(((progress || []) as { lesson_id: string; watched_seconds: number; completed: boolean }[]).map(p => [p.lesson_id, p]));
      const attsByLesson = new Map<string, { score: number; total: number; passed: boolean }[]>();
      (attempts || []).forEach((a: { lesson_id: string; score: number; total: number; passed: boolean }) => {
        const arr = attsByLesson.get(a.lesson_id) || []; arr.push(a); attsByLesson.set(a.lesson_id, arr);
      });
      const lessonsByCourse = new Map<string, { id: string; title: string; duration_seconds: number; position: number }[]>();
      (lessons || []).forEach((l: { id: string; course_id: string; title: string; duration_seconds: number; position: number }) => {
        const arr = lessonsByCourse.get(l.course_id) || []; arr.push(l); lessonsByCourse.set(l.course_id, arr);
      });
      const out: CourseDetail[] = (courses || []).map((c: { id: string; title: string; emoji: string }) => {
        const ls = lessonsByCourse.get(c.id) || [];
        const lessonRows = ls.map(l => {
          const p = progByLesson.get(l.id);
          const watched = p?.watched_seconds || 0;
          const atts = attsByLesson.get(l.id) || [];
          const bestScore = atts.reduce((m, a) => Math.max(m, a.total ? Math.round((a.score/a.total)*100) : 0), 0);
          return {
            id: l.id, title: l.title, runtime: l.duration_seconds || 0, watched,
            pct: l.duration_seconds ? Math.min(100, Math.round((watched / l.duration_seconds) * 100)) : 0,
            completed: !!p?.completed, bestScore,
          };
        });
        const totalRuntime = ls.reduce((s, l) => s + (l.duration_seconds || 0), 0);
        const totalWatched = lessonRows.reduce((s, l) => s + l.watched, 0);
        const lessonsCompleted = lessonRows.filter(l => l.completed).length;
        const allScores = lessonRows.map(l => l.bestScore).filter(s => s > 0);
        const avgScore = allScores.length ? Math.round(allScores.reduce((s, x) => s + x, 0) / allScores.length) : 0;
        const status: CourseDetail['status'] =
          ls.length > 0 && lessonsCompleted === ls.length ? 'completed'
          : totalWatched > 0 ? 'in-progress' : 'not-started';
        return {
          id: c.id, title: c.title, emoji: c.emoji, enrolled: enrolledIds.has(c.id),
          totalRuntime, totalWatched, lessonsTotal: ls.length, lessonsCompleted, avgScore, status, lessons: lessonRows,
        };
      });
      // Show only courses the user is enrolled in OR has any activity on.
      setDetails(out.filter(c => c.enrolled || c.totalWatched > 0 || c.lessons.some(l => l.bestScore > 0)));
      setLoading(false);
    })();
  }, [user.id]);

  const attended = details.filter(c => c.totalWatched > 0).length;
  const completed = details.filter(c => c.status === 'completed').length;
  const totalWatch = details.reduce((s, c) => s + c.totalWatched, 0);

  return (
    <div onClick={onClose} style={{position:'fixed', inset:0, background:'rgba(10,31,61,.55)', zIndex:1000, display:'grid', placeItems:'center', padding:24, animation:'fadeUp .2s'}}>
      <div onClick={e=>e.stopPropagation()} style={{background:'#fff', borderRadius:14, maxWidth:920, width:'100%', maxHeight:'90vh', display:'flex', flexDirection:'column', overflow:'hidden'}}>
        <div style={{padding:'20px 24px', borderBottom:'1px solid #EEF2F7', display:'flex', alignItems:'center', gap:14}}>
          <Avatar name={user.name} size={42}/>
          <div style={{flex:1, minWidth:0}}>
            <div style={{fontSize:16, fontWeight:800, color:'#002A4B'}}>{user.name}</div>
            <div style={{fontSize:12, color:'#5B6A7D'}}>{user.email} · <code style={{background:'#F7F9FC', padding:'2px 6px', borderRadius:4, color:'#0072FF', fontWeight:700}}>{user.empId}</code></div>
          </div>
          <button onClick={onClose} style={{padding:'6px 14px', background:'#F7F9FC', border:'1px solid #DDE4ED', borderRadius:8, fontSize:13, fontWeight:600, color:'#3B4A5E', cursor:'pointer'}}>Close</button>
        </div>

        <div style={{padding:'16px 24px', display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, borderBottom:'1px solid #EEF2F7', background:'#FAFBFD'}}>
          <MiniStat label="Courses attended" v={String(attended)}/>
          <MiniStat label="Courses completed" v={String(completed)}/>
          <MiniStat label="Total watch time" v={fmt(totalWatch)}/>
        </div>

        <div style={{flex:1, overflowY:'auto', padding:'16px 24px 24px'}}>
          {loading ? (
            <div style={{padding:24, color:'#5B6A7D', fontSize:13}}>Loading employee details…</div>
          ) : details.length === 0 ? (
            <div style={{padding:24, color:'#8A97A8', fontSize:13}}>No course activity yet.</div>
          ) : details.map(c => (
            <div key={c.id} style={{marginBottom:14, border:'1px solid #EEF2F7', borderRadius:12, overflow:'hidden'}}>
              <div style={{padding:'12px 16px', background:'#FAFBFD', display:'flex', alignItems:'center', gap:12}}>
                <div style={{fontSize:20}}>{c.emoji}</div>
                <div style={{flex:1, minWidth:0}}>
                  <div style={{fontSize:14, fontWeight:700, color:'#002A4B'}}>{c.title}</div>
                  <div style={{fontSize:11, color:'#5B6A7D', marginTop:2}}>
                    {c.lessonsCompleted}/{c.lessonsTotal} videos · {fmt(c.totalWatched)} of {fmt(c.totalRuntime)} watched
                    {c.avgScore > 0 && <> · avg quiz {c.avgScore}%</>}
                  </div>
                </div>
                <Chip color={c.status==='completed'?'#17A674':c.status==='in-progress'?'#E08A1E':'#8A97A8'}>
                  {c.status==='completed'?'Completed':c.status==='in-progress'?'In progress':'Not started'}
                </Chip>
              </div>
              {c.lessons.length > 0 && (
                <table style={{width:'100%', borderCollapse:'collapse'}}>
                  <thead>
                    <tr style={{background:'#fff'}}>
                      {['Video','Watched','Of runtime','Quiz','Status'].map(h => (
                        <th key={h} style={{padding:'8px 14px', textAlign:'left', fontSize:10, color:'#8A97A8', fontWeight:700, letterSpacing:'.08em', borderBottom:'1px solid #F1F4F9'}}>{h.toUpperCase()}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {c.lessons.map(l => (
                      <tr key={l.id} style={{borderBottom:'1px solid #F7F9FC'}}>
                        <td style={{padding:'8px 14px', fontSize:13, color:'#3B4A5E'}}>{l.title}</td>
                        <td style={{padding:'8px 14px', fontSize:13, fontWeight:700, color:'#002A4B'}}>{fmt(l.watched)}</td>
                        <td style={{padding:'8px 14px', minWidth:160}}><ProgressBar value={l.pct} showLabel height={4}/></td>
                        <td style={{padding:'8px 14px', fontSize:12, color: l.bestScore>=70?'#17A674':l.bestScore>0?'#C2261D':'#8A97A8', fontWeight:700}}>{l.bestScore>0?`${l.bestScore}%`:'—'}</td>
                        <td style={{padding:'8px 14px'}}>
                          <Chip color={l.completed?'#17A674':l.watched>0?'#E08A1E':'#8A97A8'}>{l.completed?'Done':l.watched>0?'Watching':'—'}</Chip>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, v }: { label: string; v: string }) {
  return (
    <div>
      <div style={{fontSize:10, fontWeight:700, color:'#8A97A8', letterSpacing:'.08em'}}>{label.toUpperCase()}</div>
      <div style={{fontSize:20, fontWeight:800, color:'#002A4B', marginTop:2}}>{v}</div>
    </div>
  );
}

function PerLessonWatch({ lessonId, runtime, courseId }: { lessonId: string; runtime: number; courseId: string }) {
  const [rows, setRows] = useState<{ id: string; name: string; email: string; sec: number; pct: number; completed: boolean }[]>([]);
  const load = async () => {
    const [{ data: enrolls }, { data: progress }, { data: profiles }] = await Promise.all([
      supabase.from('enrollments').select('user_id').eq('course_id', courseId),
      supabase.from('lesson_progress').select('user_id, watched_seconds, completed').eq('lesson_id', lessonId),
      supabase.from('profiles').select('id, full_name, email'),
    ]);
    const enrolledIds = new Set((enrolls || []).map((e: { user_id: string }) => e.user_id));
    const profById = new Map(((profiles || []) as { id: string; full_name: string; email: string }[]).map(p => [p.id, p]));
    const progByUser = new Map(((progress || []) as { user_id: string; watched_seconds: number; completed: boolean }[]).map(p => [p.user_id, p]));
    const out = Array.from(enrolledIds).map(uid => {
      const u = profById.get(uid);
      const p = progByUser.get(uid);
      const sec = p?.watched_seconds || 0;
      return {
        id: uid, name: u?.full_name || u?.email || '—', email: u?.email || '',
        sec, pct: runtime ? Math.min(100, Math.round((sec / runtime) * 100)) : 0,
        completed: !!p?.completed,
      };
    });
    out.sort((a, b) => b.sec - a.sec);
    setRows(out);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [lessonId, runtime, courseId]);
  useEffect(() => {
    const ch = supabase
      .channel(`per-lesson-${lessonId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lesson_progress', filter: `lesson_id=eq.${lessonId}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId]);

  useEffect(() => {
    const id = setInterval(() => load(), 5000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId, runtime, courseId]);

  if (rows.length === 0) return <div style={{padding:24, fontSize:13, color:'#8A97A8'}}>No learners enrolled yet.</div>;
  return (
    <div style={{maxHeight:340, overflowY:'auto'}}>
      <table style={{width:'100%', borderCollapse:'collapse'}}>
        <thead>
          <tr style={{background:'#FAFBFE'}}>
            {['Employee','Watched','Of runtime','Status'].map(h => (
              <th key={h} style={{padding:'10px 16px', textAlign:'left', fontSize:10, color:'#8A97A8', fontWeight:700, letterSpacing:'.08em', borderBottom:'1px solid #EEF2F7'}}>{h.toUpperCase()}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} style={{borderBottom:'1px solid #F7F9FC'}}>
              <td style={{padding:'10px 16px'}}>
                <div style={{display:'flex', alignItems:'center', gap:10}}>
                  <Avatar name={r.name} size={26}/>
                  <div>
                    <div style={{fontSize:13, fontWeight:600, color:'#002A4B'}}>{r.name}</div>
                    <div style={{fontSize:11, color:'#5B6A7D'}}>{r.email}</div>
                  </div>
                </div>
              </td>
              <td style={{padding:'10px 16px', fontSize:13, fontWeight:700, color:'#002A4B'}}>{fmt(r.sec)}</td>
              <td style={{padding:'10px 16px', minWidth:200}}><ProgressBar value={r.pct} showLabel/></td>
              <td style={{padding:'10px 16px'}}>
                <Chip color={r.completed?'#17A674':r.sec>0?'#E08A1E':'#8A97A8'}>{r.completed?'Completed':r.sec>0?'In progress':'Not started'}</Chip>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Tile({ label, v, sub, c }: { label:string; v:string; sub:string; c:string }) {
  return (
    <Card pad={18}>
      <div className="eyebrow" style={{color:'#8A97A8'}}>{label.toUpperCase()}</div>
      <div style={{fontSize:26, fontWeight:900, color:'#002A4B', letterSpacing:'-.02em', marginTop:6}}>{v}</div>
      <div style={{fontSize:12, color:c, fontWeight:600}}>{sub}</div>
    </Card>
  );
}
