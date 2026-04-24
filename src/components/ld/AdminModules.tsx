// Admin Modules: list/edit/delete courses & lessons
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Btn, Card, Chip, EmptyState } from "./ui";
import type { Nav } from "./App";

type Course = { id: string; title: string; tag: string; emoji: string; published_at: string | null };
type Lesson = { id: string; title: string; course_id: string; duration_seconds: number; video_path: string | null };

export function AdminModules({ onNav }: { onNav: Nav }) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const [{ data: cs }, { data: ls }] = await Promise.all([
      supabase.from('courses').select('id, title, tag, emoji, published_at').order('created_at', { ascending: false }),
      supabase.from('lessons').select('id, title, course_id, duration_seconds, video_path').order('position', { ascending: true }),
    ]);
    setCourses(cs || []);
    setLessons(ls || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const deleteLesson = async (l: Lesson) => {
    if (!confirm(`Delete video "${l.title}"? This removes it for all learners.`)) return;
    if (l.video_path) await supabase.storage.from('course-videos').remove([l.video_path]);
    await supabase.from('lessons').delete().eq('id', l.id);
    load();
  };

  const deleteCourse = async (c: Course) => {
    if (!confirm(`Delete course "${c.title}" and ALL its videos & quizzes?`)) return;
    const courseLessons = lessons.filter(l => l.course_id === c.id);
    const paths = courseLessons.map(l => l.video_path).filter(Boolean) as string[];
    if (paths.length) await supabase.storage.from('course-videos').remove(paths);
    await supabase.from('courses').delete().eq('id', c.id);
    load();
  };

  return (
    <div style={{padding:'28px 36px 48px', animation:'fadeUp .3s'}}>
      <div style={{display:'flex', alignItems:'center', marginBottom:20}}>
        <div>
          <h2 style={{fontSize:22, color:'#0A1F3D', margin:0, letterSpacing:'-.02em', fontWeight:800}}>Course modules</h2>
          <div style={{fontSize:13, color:'#5B6A7D', marginTop:4}}>{courses.length} course{courses.length===1?'':'s'} · {lessons.length} video{lessons.length===1?'':'s'}</div>
        </div>
        <div style={{marginLeft:'auto'}}><Btn onClick={()=>onNav('admin-upload')}>+ Add new course</Btn></div>
      </div>

      {loading ? <Card pad={24} style={{color:'#5B6A7D', fontSize:13}}>Loading…</Card>
       : courses.length === 0 ? <EmptyState icon="📚" title="No courses yet" sub="Create your first course in Upload & Quiz." action={<Btn onClick={()=>onNav('admin-upload')}>+ New course</Btn>}/>
       : (
        <div style={{display:'flex', flexDirection:'column', gap:12}}>
          {courses.map(c => {
            const cl = lessons.filter(l => l.course_id === c.id);
            const open = expanded === c.id;
            return (
              <Card key={c.id} pad={0}>
                <div style={{padding:'16px 20px', display:'flex', alignItems:'center', gap:14, cursor:'pointer'}} onClick={()=>setExpanded(open?null:c.id)}>
                  <div style={{fontSize:26}}>{c.emoji}</div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:15, fontWeight:700, color:'#0A1F3D'}}>{c.title}</div>
                    <div style={{fontSize:12, color:'#5B6A7D', marginTop:2}}>{cl.length} video{cl.length===1?'':'s'} · {c.published_at ? 'Published' : 'Draft'}</div>
                  </div>
                  <Chip color={c.tag==='Mandatory'?'#C2261D':'#0072FF'}>{c.tag}</Chip>
                  <Btn size="sm" variant="danger" onClick={(e)=>{ e.stopPropagation(); deleteCourse(c); }}>Delete</Btn>
                  <div style={{fontSize:18, color:'#8A97A8', transform: open?'rotate(90deg)':'none', transition:'.15s'}}>›</div>
                </div>
                {open && (
                  <div style={{borderTop:'1px solid #EEF2F7'}}>
                    {cl.length === 0 ? (
                      <div style={{padding:20, fontSize:13, color:'#8A97A8', textAlign:'center'}}>No videos yet.</div>
                    ) : cl.map(l => (
                      <div key={l.id} style={{padding:'12px 20px 12px 60px', display:'flex', alignItems:'center', gap:12, borderBottom:'1px solid #F7F9FC'}}>
                        <div style={{fontSize:18}}>🎬</div>
                        <div style={{flex:1}}>
                          <div style={{fontSize:13, fontWeight:600, color:'#0A1F3D'}}>{l.title}</div>
                          <div style={{fontSize:11, color:'#8A97A8', marginTop:2}}>{Math.floor(l.duration_seconds/60)}m {l.duration_seconds%60}s · {l.video_path ? 'Uploaded' : 'No file'}</div>
                        </div>
                        <Btn size="sm" variant="danger" onClick={()=>deleteLesson(l)}>Remove</Btn>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
