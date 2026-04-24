import { useState, useEffect } from "react";
import { useUserCourses, ensureEnrollment } from "./queries";
import { useAuth } from "./auth";
import { Btn, Chip, ProgressBar, Icon, EmptyState } from "./ui";
import type { Nav } from "./App";
import type { CourseWithProgress } from "./data";

export function Courses({ onNav, initialQuery }: { onNav: Nav; initialQuery?: string }) {
  const { user } = useAuth();
  const { items: courses, loading, reload } = useUserCourses(user?.id ?? null);
  const [filter, setFilter] = useState<'all'|'required'|'progress'|'completed'>('all');
  const [q, setQ] = useState(initialQuery || '');

  useEffect(() => { if (initialQuery !== undefined) setQ(initialQuery); }, [initialQuery]);

  const norm = (s: string) => s.toLowerCase().trim();
  const query = norm(q);
  const isInProgress = (c: CourseWithProgress) => (c.started || c.progress > 0) && c.progress < 100;
  const filtered = courses.filter(c => {
    if (filter === 'required' && c.tag !== 'Mandatory') return false;
    if (filter === 'progress' && !isInProgress(c)) return false;
    if (filter === 'completed' && c.progress !== 100) return false;
    if (query) {
      const hay = `${c.title} ${c.instructor} ${c.blurb} ${c.tag}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });

  const open = async (c: CourseWithProgress) => {
    if (user && !c.enrolled) await ensureEnrollment(user.id, c.id);
    onNav('player', { course: c.id });
    reload();
  };

  return (
    <div style={{padding:'28px 40px 56px', maxWidth:1180, animation:'fadeUp .35s ease-out'}}>
      <div style={{display:'flex', alignItems:'center', gap:12, marginBottom:22}}>
        <div>
          <h2 style={{fontSize:22, color:'#0A1F3D', margin:0, letterSpacing:'-.02em', fontWeight:700}}>My courses</h2>
          <div style={{fontSize:13, color:'#5B6A7D', marginTop:3}}>{courses.filter(c=>c.tag==='Mandatory').length} required · {courses.filter(isInProgress).length} in progress</div>
        </div>
        <div style={{marginLeft:'auto', display:'flex', gap:10, alignItems:'center'}}>
          <div style={{position:'relative'}}>
            <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search…" style={{padding:'9px 14px 9px 34px', border:'1px solid #DDE4ED', borderRadius:10, fontSize:13, minWidth:220, outline:'none', background:'#fff'}}/>
            <div style={{position:'absolute', left:10, top:10, color:'#8A97A8'}}><Icon d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" size={14}/></div>
          </div>
          <div style={{display:'flex', padding:3, background:'#EEF2F7', borderRadius:10}}>
            {([['all','All'],['required','Required'],['progress','In progress'],['completed','Done']] as const).map(([k,l]) => (
              <button key={k} onClick={()=>setFilter(k)} style={{padding:'6px 12px', fontSize:12, fontWeight:600, border:0, borderRadius:8, cursor:'pointer', background: filter===k?'#fff':'transparent', color: filter===k?'#0A1F3D':'#5B6A7D', boxShadow: filter===k?'0 1px 2px rgba(0,42,75,.08)':'none'}}>{l}</button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{padding:40, color:'#5B6A7D', fontSize:13, textAlign:'center'}}>Loading courses…</div>
      ) : courses.length === 0 ? (
        <EmptyState icon="📚" title="No courses yet" sub="Your L&D admin hasn't published any courses. Once they do, they'll appear here automatically."/>
      ) : filtered.length === 0 ? (
        <EmptyState icon="🔍" title="No matches" sub="Try a different filter or search term."/>
      ) : (
        <div style={{display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:16}}>
          {filtered.map((c, i) => (
            <div key={c.id} onClick={()=>open(c)} style={{animation:`fadeUp .35s ease-out ${i*.04}s both`, background:'#fff', borderRadius:14, border:'1px solid #EEF2F7', overflow:'hidden', cursor:'pointer', transition:'all .18s'}}>
              <div style={{position:'relative', height:110, background:`linear-gradient(135deg, ${c.hue}, ${c.hue}CC)`, overflow:'hidden'}}>
                <div style={{position:'absolute', inset:0, background:'radial-gradient(circle at 80% 20%, rgba(255,255,255,.25), transparent 55%)'}}/>
                <div style={{position:'absolute', bottom:-20, right:-4, fontSize:96, opacity:.9}}>{c.emoji}</div>
                <div style={{position:'absolute', top:12, left:12}}>
                  <Chip color="#fff" bg="rgba(255,255,255,.2)" style={{border:'1px solid rgba(255,255,255,.3)'}}>{c.tag}</Chip>
                </div>
                {c.progress===100 && <div style={{position:'absolute', top:12, right:12, background:'rgba(255,255,255,.95)', color:'#17A674', fontSize:11, fontWeight:700, padding:'3px 9px', borderRadius:999}}>Completed</div>}
                {c.progress<100 && isInProgress(c) && <div style={{position:'absolute', top:12, right:12, background:'rgba(255,255,255,.95)', color:'#0072FF', fontSize:11, fontWeight:700, padding:'3px 9px', borderRadius:999}}>In progress</div>}
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
      )}
    </div>
  );
}
