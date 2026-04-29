import { useState, useEffect } from "react";
import { useUserCourses, ensureEnrollment } from "./queries";
import { useAuth } from "./auth";
import { Btn, Chip, ProgressBar, EmptyState } from "./ui";
import type { Nav } from "./App";
import type { CourseWithProgress } from "./data";

export function Courses({ onNav, initialQuery }: { onNav: Nav; initialQuery?: string }) {
  const { user } = useAuth();
  const { items: courses, loading, reload } = useUserCourses(user?.id ?? null);
  const [q, setQ] = useState(initialQuery || '');

  useEffect(() => { if (initialQuery !== undefined) setQ(initialQuery); }, [initialQuery]);

  const norm = (s: string) => s.toLowerCase().trim();
  const query = norm(q);
  const isInProgress = (c: CourseWithProgress) => (c.started || c.progress > 0) && c.progress < 100;
  // The course is "blocked on signing" when video + quiz are done (progress=100
  // would be there if not for the agreement gate) but they haven't signed yet.
  // We detect by: agreement_required, not signed, and meaningful progress made.
  const isAwaitingSignature = (c: CourseWithProgress) =>
    c.agreement_required && !c.agreement_signed && c.started;
  const enrolled = courses.filter(c => c.enrolled);
  const filtered = enrolled.filter(c => {
    if (!query) return true;
    const hay = `${c.title} ${c.instructor} ${c.blurb} ${c.tag}`.toLowerCase();
    return hay.includes(query);
  });

  const notStarted = filtered.filter(c => !c.started && c.progress === 0);
  const inProgress = filtered.filter(c => isInProgress(c));
  const completed = filtered.filter(c => c.progress === 100);

  const open = async (c: CourseWithProgress) => {
    if (user && !c.enrolled) await ensureEnrollment(user.id, c.id);
    onNav('player', { course: c.id });
    reload();
  };

  const Section = ({ title, items }: { title: string; items: CourseWithProgress[] }) => {
    if (items.length === 0) return null;
    return (
      <div style={{marginTop:22}}>
        <div style={{display:'flex', alignItems:'center', marginBottom:12}}>
          <div style={{fontSize:13, fontWeight:800, color:'#002A4B', letterSpacing:'-.01em'}}>{title}</div>
          <div style={{marginLeft:'auto', fontSize:12, color:'#5B6A7D'}}>{items.length}</div>
        </div>
        <div style={{display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:16}}>
          {items.map((c) => (
            <div key={c.id} onClick={()=>open(c)} style={{background:'#fff', borderRadius:14, border:'1px solid #EEF2F7', overflow:'hidden', cursor:'pointer', transition:'all .18s'}}>
              <div style={{position:'relative', height:110, background:`linear-gradient(135deg, ${c.hue}, ${c.hue}CC)`, overflow:'hidden'}}>
                <div style={{position:'absolute', inset:0, background:'radial-gradient(circle at 80% 20%, rgba(255,255,255,.25), transparent 55%)'}}/>
                <div style={{position:'absolute', bottom:-20, right:-4, fontSize:96, opacity:.9}}>{c.emoji}</div>
                <div style={{position:'absolute', top:12, left:12}}>
                  <Chip color="#fff" bg="rgba(255,255,255,.2)" style={{border:'1px solid rgba(255,255,255,.3)'}}>{c.tag}</Chip>
                </div>
                {c.progress===100 && <div style={{position:'absolute', top:12, right:12, background:'rgba(255,255,255,.95)', color:'#17A674', fontSize:11, fontWeight:700, padding:'3px 9px', borderRadius:999}}>Completed</div>}
                {c.progress<100 && isInProgress(c) && !isAwaitingSignature(c) && <div style={{position:'absolute', top:12, right:12, background:'rgba(255,255,255,.95)', color:'#0072FF', fontSize:11, fontWeight:700, padding:'3px 9px', borderRadius:999}}>In progress</div>}
                {c.progress<100 && isAwaitingSignature(c) && <div style={{position:'absolute', top:12, right:12, background:'rgba(255,255,255,.95)', color:'#9A6708', fontSize:11, fontWeight:700, padding:'3px 9px', borderRadius:999}} title="Sign the course agreement to mark this course complete.">⚠ Agreement signing incomplete</div>}
              </div>
              <div style={{padding:16}}>
                <div style={{fontSize:15, fontWeight:700, color:'#0A1F3D', letterSpacing:'-.01em'}}>{c.title}</div>
                <p style={{fontSize:12, color:'#5B6A7D', margin:'5px 0 12px', lineHeight:1.45, minHeight:34}}>{c.blurb}</p>
                <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:10, fontSize:12, color:'#5B6A7D'}}>
                  <span>{c.instructor || '—'}</span>
                  <span style={{marginLeft:'auto'}}>{c.lessons_total} videos · {c.duration_label || '—'}</span>
                </div>
                {isInProgress(c) || c.progress === 100
                  ? <ProgressBar value={c.progress} showLabel/>
                  : <Btn full variant="soft" size="sm">{c.lessons_total ? 'Start course →' : 'No lessons yet'}</Btn>}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div style={{padding:'18px 0 56px'}}>
      <div style={{display:'flex', alignItems:'center', gap:12, marginBottom:12}}>
        <div style={{fontSize:18, fontWeight:800, color:'#0A1F3D'}}>Courses</div>
        <div style={{marginLeft:'auto'}}>
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search…" style={{padding:'9px 14px', border:'1px solid #DDE4ED', borderRadius:10, fontSize:13, minWidth:240, outline:'none', background:'#fff'}}/>
        </div>
      </div>

      {loading ? (
        <div style={{padding:40, color:'#5B6A7D', fontSize:13, textAlign:'center'}}>Loading courses…</div>
      ) : enrolled.length === 0 ? (
        <EmptyState icon="📚" title="No courses yet" sub="Your Compliance admin hasn't published any courses. Once they do, they'll appear here automatically."/>
      ) : filtered.length === 0 ? (
        <EmptyState icon="🔍" title="No matches" sub="Try a different filter or search term."/>
      ) : (
        <>
          <Section title="NOT STARTED" items={notStarted}/>
          <Section title="IN PROGRESS" items={inProgress}/>
          <Section title="COMPLETED" items={completed}/>
        </>
      )}
    </div>
  );
}
