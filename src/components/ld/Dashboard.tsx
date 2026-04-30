import { useUserCourses, ensureEnrollment } from "./queries";
import { Card, ProgressBar, Icon, EmptyState, Btn } from "./ui";
import { useAuth } from "./auth";
import type { Nav } from "./App";
import type { CourseWithProgress } from "./data";

export function Dashboard({ onNav }: { onNav: Nav }) {
  const { user, profile } = useAuth();
  const { items: courses, loading, reload } = useUserCourses(user?.id ?? null);

  const required = courses.filter(c => c.tag === 'Mandatory');
  // "In progress" = the user has started watching OR has partial completions, but isn't finished.
  const isInProgress = (c: CourseWithProgress) => (c.started || c.progress > 0) && c.progress < 100;
  const inProgress = courses.filter(c => isInProgress(c) && c.tag !== 'Mandatory');
  const completedCount = courses.filter(c => c.progress === 100).length;
  const reqDone = required.filter(c => c.progress === 100).length;
  const remaining = required.filter(c => c.progress < 100).length;
  const inProgressTotal = courses.filter(isInProgress).length;

  const openCourse = async (c: CourseWithProgress) => {
    // Strict access — only an existing enrollment (created by the admin
    // publish flow) lets a learner open a course. No silent lazy-enroll.
    if (user && !c.enrolled) {
      const ok = await ensureEnrollment(user.id, c.id);
      if (!ok) {
        alert('You are not enrolled in this course. Please contact your admin if this is unexpected.');
        return;
      }
    }
    onNav('player', { course: c.id });
    reload();
  };

  const firstName = (profile?.full_name || profile?.email || 'there').split(' ')[0];

  return (
    <div style={{padding:'32px 40px 56px', maxWidth:1180, animation:'fadeUp .35s ease-out'}}>
      <div style={{marginBottom:28}}>
        <div style={{fontSize:13, color:'#5B6A7D', fontWeight:500}}>Welcome, {firstName}</div>
        <h2 style={{fontSize:28, color:'#0A1F3D', margin:'4px 0 0', letterSpacing:'-.02em', fontWeight:700}}>
          {required.length === 0
            ? <>No required training assigned yet.</>
            : <>You have <span style={{color:'#0072FF'}}>{remaining} required {remaining===1?'course':'courses'}</span> to complete.</>}
        </h2>
      </div>

      <div style={{display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:14, marginBottom:32}}>
        <MiniTile label="Required" value={`${reqDone}/${required.length}`} sub="completed"/>
        <MiniTile label="In progress" value={String(inProgressTotal)} sub="courses active"/>
        <MiniTile label="Completed" value={String(completedCount)} sub="this year"/>
      </div>

      <SectionHeader title="Required training" subtitle="Assigned by HR. Complete before the due date."/>
      {loading ? (
        <Card pad={24} style={{marginBottom:32, color:'#5B6A7D', fontSize:13}}>Loading…</Card>
      ) : required.length === 0 ? (
        <Card pad={0} style={{marginBottom:32}}>
          <EmptyState icon="🎓" title="Nothing required yet" sub="When your Compliance team publishes mandatory training, it'll show up here." action={<Btn variant="soft" onClick={()=>onNav('courses')}>Browse all courses</Btn>}/>
        </Card>
      ) : (
        <Card pad={0} style={{marginBottom:32, overflow:'hidden'}}>
          {required.map((c,i) => (
            <RequiredRow key={c.id} c={c} last={i===required.length-1} onClick={()=>openCourse(c)}/>
          ))}
        </Card>
      )}

      {inProgress.length > 0 && (
        <>
          <SectionHeader title="Continue learning" subtitle="Optional courses you've started."
            action={<a onClick={()=>onNav('courses')} style={{fontSize:13, color:'#0072FF', cursor:'pointer', fontWeight:600}}>All courses →</a>}/>
          <div style={{display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:14}}>
            {inProgress.map(c => (
              <div key={c.id} onClick={()=>openCourse(c)}
                style={{background:'#fff', borderRadius:12, border:'1px solid #EEF2F7', padding:18, cursor:'pointer', display:'flex', gap:14, alignItems:'center', transition:'all .15s'}}>
                <div style={{width:42, height:42, borderRadius:10, background:`${c.hue}18`, color:c.hue, display:'grid', placeItems:'center', fontSize:18, flexShrink:0}}>{c.emoji}</div>
                <div style={{flex:1, minWidth:0}}>
                  <div style={{fontSize:14, fontWeight:700, color:'#0A1F3D'}}>{c.title}</div>
                  <div style={{fontSize:12, color:'#5B6A7D', marginTop:2}}>{c.instructor}</div>
                  <div style={{marginTop:8}}><ProgressBar value={c.progress} height={4}/></div>
                </div>
                <div style={{fontSize:13, fontWeight:700, color:'#0A1F3D', minWidth:36, textAlign:'right'}}>{c.progress}%</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function SectionHeader({ title, subtitle, action }: { title:string; subtitle?:string; action?: React.ReactNode }) {
  return (
    <div style={{display:'flex', alignItems:'center', marginBottom:12}}>
      <div>
        <div style={{fontSize:15, fontWeight:700, color:'#0A1F3D', letterSpacing:'-.01em'}}>{title}</div>
        {subtitle && <div style={{fontSize:12, color:'#5B6A7D', marginTop:2}}>{subtitle}</div>}
      </div>
      {action && <div style={{marginLeft:'auto'}}>{action}</div>}
    </div>
  );
}

function MiniTile({ label, value, sub }: { label:string; value:string; sub:string }) {
  return (
    <div style={{background:'#fff', borderRadius:12, border:'1px solid #EEF2F7', padding:'18px 20px'}}>
      <div style={{fontSize:11, fontWeight:600, color:'#8A97A8', letterSpacing:'.06em', textTransform:'uppercase'}}>{label}</div>
      <div style={{display:'flex', alignItems:'baseline', gap:8, marginTop:6}}>
        <div style={{fontSize:28, fontWeight:700, color:'#0A1F3D', letterSpacing:'-.02em', lineHeight:1}}>{value}</div>
        <div style={{fontSize:12, color:'#5B6A7D'}}>{sub}</div>
      </div>
    </div>
  );
}

function RequiredRow({ c, last, onClick }: { c: CourseWithProgress; last:boolean; onClick:()=>void }) {
  const inProgress = (c.started || c.progress > 0) && c.progress < 100;
  const notStarted = !c.started && c.progress === 0;
  return (
    <div onClick={onClick} style={{
      display:'flex', alignItems:'center', gap:16, padding:'18px 22px',
      borderBottom: last ? 'none' : '1px solid #F1F4F9',
      cursor:'pointer', transition:'background .15s'
    }}>
      <div style={{width:40, height:40, borderRadius:10, background:`${c.hue}15`, color:c.hue, display:'grid', placeItems:'center', fontSize:18, flexShrink:0}}>{c.emoji}</div>
      <div style={{flex:1, minWidth:0}}>
        <div style={{fontSize:14, fontWeight:700, color:'#0A1F3D'}}>{c.title}</div>
        <div style={{fontSize:12, color:'#5B6A7D', marginTop:2}}>{c.lessons_total} videos · {c.duration_label || '—'}{c.due_in ? ` · ${c.due_in}` : ''}</div>
      </div>
      <div style={{width:170}}>
        {c.progress === 100 ? (
          <div style={{display:'flex', alignItems:'center', gap:6, fontSize:12, fontWeight:600, color:'#17A674'}}>
            <span style={{width:16, height:16, borderRadius:99, background:'#17A674', color:'#fff', display:'grid', placeItems:'center', fontSize:10}}>✓</span>
            Completed
          </div>
        ) : inProgress ? (
          <div style={{display:'flex', alignItems:'center', gap:10}}>
            <div style={{flex:1}}><ProgressBar value={c.progress} height={4}/></div>
            <div style={{fontSize:11, fontWeight:700, color:'#0072FF', minWidth:78, textAlign:'right'}}>In progress</div>
          </div>
        ) : (
          <div style={{display:'flex', alignItems:'center', gap:6, fontSize:12, fontWeight:600, color:'#8A97A8'}}>
            <span style={{width:8, height:8, borderRadius:99, background:'#C8D2DE'}}/>
            {notStarted ? 'Assigned' : `${c.progress}%`}
          </div>
        )}
      </div>
      <div style={{fontSize:13, color:'#5B6A7D'}}><Icon d="M9 6l6 6-6 6" size={14}/></div>
    </div>
  );
}
