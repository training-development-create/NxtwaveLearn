// Admin Modules: list/edit/delete courses & lessons + edit assignment scope.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Btn, Card, Chip, EmptyState } from "./ui";
import type { Nav } from "./App";

type Course = { id: string; title: string; tag: string; emoji: string; published_at: string | null };
type Lesson = { id: string; title: string; course_id: string; duration_seconds: number; video_path: string | null };
type Dept = { id: string; name: string };
type SubDept = { id: string; name: string; department_id: string };
type EmpOpt = { id: string; name: string; email: string; department_id: string | null; sub_department_id: string | null; manager_id: string | null; designation_name: string | null; is_manager: boolean };
type Assignment = {
  id: string;
  scope_all: boolean;
  department_id: string | null;
  sub_department_id: string | null;
  manager_id: string | null;
  employee_id: string | null;
};

export function AdminModules({ onNav }: { onNav: Nav }) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editingCourseId, setEditingCourseId] = useState<string | null>(null);

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

  const editingCourse = courses.find(c => c.id === editingCourseId) || null;

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
                  <Btn size="sm" variant="soft" onClick={(e)=>{ e.stopPropagation(); setEditingCourseId(c.id); }}>Edit assignment</Btn>
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

      {editingCourse && (
        <EditAssignmentModal
          course={editingCourse}
          onClose={() => setEditingCourseId(null)}
          onSaved={() => { setEditingCourseId(null); /* nothing visible to reload here, but keeps API consistent */ }}
        />
      )}
    </div>
  );
}

// ----- Edit Assignment modal --------------------------------------------------
// Lets admin EXTEND a course's assignment scope. Shows only departments /
// sub-departments / managers / employees that are NOT already assigned (per
// the requirement). Adding a new scope inserts a new course_assignments row;
// the on_assignment_change DB trigger handles enrollments automatically.

function EditAssignmentModal({ course, onClose, onSaved }: { course: Course; onClose: () => void; onSaved: () => void }) {
  const [departments, setDepartments] = useState<Dept[]>([]);
  const [subDepartments, setSubDepartments] = useState<SubDept[]>([]);
  const [employeesAll, setEmployeesAll] = useState<EmpOpt[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [resolvedAssignedSet, setResolvedAssignedSet] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Picker selections (scopes the admin wants to ADD on top of existing).
  const [addDeptIds, setAddDeptIds] = useState<string[]>([]);
  const [addSubDeptIds, setAddSubDeptIds] = useState<string[]>([]);
  const [addManagerIds, setAddManagerIds] = useState<string[]>([]);
  const [addDesignationNames, setAddDesignationNames] = useState<string[]>([]);
  const [addEmployeeIds, setAddEmployeeIds] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      setLoading(true); setErr(null);
      // Page through employees (avoid Supabase 1000-row default).
      type Row = Omit<EmpOpt, 'is_manager'>;
      const fetchAllEmployees = async (): Promise<Row[]> => {
        const all: Row[] = [];
        const page = 1000;
        for (let from = 0; ; from += page) {
          const { data, error } = await supabase
            .from('employees')
            .select('id, name, email, department_id, sub_department_id, manager_id, designation_name, status')
            .eq('status', 'active').order('name').range(from, from + page - 1);
          if (error) { console.warn('[modules] paging stop:', error.message); break; }
          if (!data || data.length === 0) break;
          all.push(...(data as Row[]));
          if (data.length < page) break;
        }
        return all;
      };

      const [{ data: d }, { data: s }, allEmps, { data: ass }, { data: assignedRpc }] = await Promise.all([
        supabase.from('departments').select('id, name').order('name').range(0, 9999),
        supabase.from('sub_departments').select('id, name, department_id').order('name').range(0, 9999),
        fetchAllEmployees(),
        supabase.from('course_assignments').select('id, scope_all, department_id, sub_department_id, manager_id, employee_id').eq('course_id', course.id),
        supabase.rpc('assigned_employees', { _course_id: course.id }),
      ]);
      setDepartments((d || []) as Dept[]);
      setSubDepartments((s || []) as SubDept[]);
      const reportCounts = new Map<string, number>();
      allEmps.forEach(e => { if (e.manager_id) reportCounts.set(e.manager_id, (reportCounts.get(e.manager_id) ?? 0) + 1); });
      setEmployeesAll(allEmps.map(e => ({ ...e, designation_name: (e as Record<string, unknown>).designation_name as string | null ?? null, is_manager: (reportCounts.get(e.id) ?? 0) > 0 })));
      setAssignments((ass || []) as Assignment[]);
      setResolvedAssignedSet(new Set(((assignedRpc || []) as { employee_id: string }[]).map(r => r.employee_id)));
      setLoading(false);
    })();
  }, [course.id]);

  const isCurrentlyScopeAll = useMemo(() => assignments.some(a => a.scope_all), [assignments]);
  const assignedDeptIds = useMemo(() => new Set(assignments.map(a => a.department_id).filter(Boolean) as string[]), [assignments]);
  const assignedSubDeptIds = useMemo(() => new Set(assignments.map(a => a.sub_department_id).filter(Boolean) as string[]), [assignments]);
  const assignedManagerIds = useMemo(() => new Set(assignments.map(a => a.manager_id).filter(Boolean) as string[]), [assignments]);
  const assignedEmployeeIds = useMemo(() => new Set(assignments.map(a => a.employee_id).filter(Boolean) as string[]), [assignments]);

  // Cascade options (Union semantics — match the assign-time picker behaviour).
  const filteredSubDepts = subDepartments.filter(s =>
    addDeptIds.length === 0 || addDeptIds.includes(s.department_id)
  );
  const reportsByMgr = useMemo(() => {
    const m = new Map<string, EmpOpt[]>();
    employeesAll.forEach(e => {
      if (!e.manager_id) return;
      const a = m.get(e.manager_id) ?? []; a.push(e); m.set(e.manager_id, a);
    });
    return m;
  }, [employeesAll]);
  const managerOptions = useMemo(() => {
    const dSet = new Set(addDeptIds);
    const sdSet = new Set(addSubDeptIds);
    const noFilter = dSet.size === 0 && sdSet.size === 0;
    return employeesAll.filter(m => {
      if (!m.is_manager) return false;
      if (noFilter) return true;
      const reps = reportsByMgr.get(m.id) ?? [];
      return reps.some(r => {
        if (dSet.size && (!r.department_id || !dSet.has(r.department_id))) return false;
        if (sdSet.size && (!r.sub_department_id || !sdSet.has(r.sub_department_id))) return false;
        return true;
      });
    });
  }, [employeesAll, addDeptIds, addSubDeptIds, reportsByMgr]);
  const employeeOptions = employeesAll.filter(e => {
    if (addDeptIds.length && (!e.department_id || !addDeptIds.includes(e.department_id))) return false;
    if (addSubDeptIds.length && (!e.sub_department_id || !addSubDeptIds.includes(e.sub_department_id))) return false;
    if (addManagerIds.length && (!e.manager_id || !addManagerIds.includes(e.manager_id))) return false;
    if (addDesignationNames.length && (!e.designation_name || !addDesignationNames.includes(e.designation_name))) return false;
    return true;
  });

  // Designation options: narrowed by current dept/subdept/manager picks.
  const designationOptions = Array.from(
    new Set(
      employeesAll
        .filter(e => {
          if (addDeptIds.length && (!e.department_id || !addDeptIds.includes(e.department_id))) return false;
          if (addSubDeptIds.length && (!e.sub_department_id || !addSubDeptIds.includes(e.sub_department_id))) return false;
          if (addManagerIds.length && (!e.manager_id || !addManagerIds.includes(e.manager_id))) return false;
          return true;
        })
        .map(e => e.designation_name)
        .filter((d): d is string => !!d)
    )
  ).sort();

  // ---- Only show options NOT already covered by an existing assignment ----
  const availableDepts = departments.filter(d => !assignedDeptIds.has(d.id));
  const availableSubDepts = filteredSubDepts.filter(s => !assignedSubDeptIds.has(s.id));
  const availableManagers = managerOptions.filter(m => !assignedManagerIds.has(m.id));
  const availableEmployees = employeeOptions.filter(e => {
    if (assignedEmployeeIds.has(e.id)) return false;
    if (resolvedAssignedSet.has(e.id)) return false;
    return true;
  });

  const toggle = (arr: string[], setArr: (v: string[]) => void, id: string) => {
    setArr(arr.includes(id) ? arr.filter(x => x !== id) : [...arr, id]);
  };
  const anyToAdd = addDeptIds.length || addSubDeptIds.length || addManagerIds.length || addDesignationNames.length || addEmployeeIds.length;


  const save = async () => {
    if (!anyToAdd) return;
    setBusy(true); setErr(null);
    try {
      // Use only the most specific selection level. Dept/subdept/manager are
      // cascading UI filters — when employees are picked, only those matter.
      const rows: Record<string, unknown>[] = [];
      if (addEmployeeIds.length > 0) {
        addEmployeeIds.forEach(id => rows.push({ course_id: course.id, employee_id: id }));
      } else if (addManagerIds.length > 0 && addDeptIds.length === 0 && addSubDeptIds.length === 0 && addDesignationNames.length === 0) {
        // Manager-only: write manager scope so future reports auto-enroll.
        addManagerIds.forEach(id => rows.push({ course_id: course.id, manager_id: id }));
      } else if (addDeptIds.length > 0 && addSubDeptIds.length === 0 && addManagerIds.length === 0 && addDesignationNames.length === 0) {
        // Dept-only: write dept scope so future joiners auto-enroll.
        addDeptIds.forEach(id => rows.push({ course_id: course.id, department_id: id }));
      } else if (addSubDeptIds.length > 0 && addDeptIds.length === 0 && addManagerIds.length === 0 && addDesignationNames.length === 0) {
        // Sub-dept only: write sub-dept scope.
        addSubDeptIds.forEach(id => rows.push({ course_id: course.id, sub_department_id: id }));
      } else {
        // Mixed / designation filter → snapshot intersection as employee_id rows.
        const resolvedIds = new Set<string>();
        employeesAll.forEach(e => {
          if (addDeptIds.length && (!e.department_id || !addDeptIds.includes(e.department_id))) return;
          if (addSubDeptIds.length && (!e.sub_department_id || !addSubDeptIds.includes(e.sub_department_id))) return;
          if (addManagerIds.length && (!e.manager_id || !addManagerIds.includes(e.manager_id))) return;
          if (addDesignationNames.length && (!e.designation_name || !addDesignationNames.includes(e.designation_name))) return;
          resolvedIds.add(e.id);
        });
        resolvedIds.forEach(id => rows.push({ course_id: course.id, employee_id: id }));
      }
      if (rows.length) {
        const { error } = await supabase.from('course_assignments').insert(rows);
        if (error) throw error;
      }
      onSaved();
    } catch (e) {
      setErr((e as Error).message || 'Could not save assignment changes.');
      setBusy(false);
    }
  };

  const removeAssignment = async (a: Assignment) => {
    if (!confirm('Remove this scope from the course? Employees only covered by this scope will lose access.')) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.from('course_assignments').delete().eq('id', a.id);
    if (error) { setErr(error.message); setBusy(false); return; }
    setAssignments(prev => prev.filter(x => x.id !== a.id));
    setBusy(false);
  };

  const labelFor = (a: Assignment): string => {
    if (a.scope_all) return 'All employees';
    if (a.department_id) return `Department: ${departments.find(d => d.id === a.department_id)?.name ?? a.department_id}`;
    if (a.sub_department_id) return `Sub-dept: ${subDepartments.find(s => s.id === a.sub_department_id)?.name ?? a.sub_department_id}`;
    if (a.manager_id) {
      const m = employeesAll.find(e => e.id === a.manager_id);
      return `Manager: ${m?.name || m?.email || a.manager_id}`;
    }
    if (a.employee_id) {
      const e = employeesAll.find(x => x.id === a.employee_id);
      return `Employee: ${e?.name || e?.email || a.employee_id}`;
    }
    return 'Unknown scope';
  };

  return (
    <div onClick={onClose} style={{position:'fixed', inset:0, background:'rgba(10,31,61,.55)', zIndex:1000, display:'grid', placeItems:'center', padding:24, animation:'fadeUp .2s'}}>
      <div onClick={e=>e.stopPropagation()} style={{background:'#fff', borderRadius:14, maxWidth:900, width:'100%', maxHeight:'90vh', display:'flex', flexDirection:'column', overflow:'hidden'}}>
        <div style={{padding:'18px 22px', borderBottom:'1px solid #EEF2F7', display:'flex', alignItems:'center', gap:12}}>
          <div style={{fontSize:24}}>{course.emoji}</div>
          <div style={{flex:1, minWidth:0}}>
            <div style={{fontSize:11, fontWeight:700, color:'#8A97A8', letterSpacing:'.06em', textTransform:'uppercase'}}>Edit assignment</div>
            <div style={{fontSize:16, fontWeight:800, color:'#0A1F3D'}}>{course.title}</div>
          </div>
          <button onClick={onClose} style={{padding:'6px 14px', background:'#F7F9FC', border:'1px solid #DDE4ED', borderRadius:8, fontSize:13, fontWeight:600, color:'#3B4A5E', cursor:'pointer'}}>Close</button>
        </div>

        {loading ? (
          <div style={{padding:40, color:'#5B6A7D', fontSize:13, textAlign:'center'}}>Loading current assignment…</div>
        ) : (
          <div style={{flex:1, overflowY:'auto', padding:'18px 22px 22px'}}>
            {/* Currently assigned scopes */}
            <div style={{marginBottom:18}}>
              <div className="eyebrow">CURRENTLY ASSIGNED ({assignments.length})</div>
              {assignments.length === 0 ? (
                <div style={{marginTop:8, padding:12, fontSize:12, color:'#8A97A8', background:'#F7F9FC', borderRadius:8}}>No scopes yet — nobody is enrolled in this course.</div>
              ) : (
                <div style={{marginTop:8, display:'flex', flexDirection:'column', gap:6}}>
                  {assignments.map(a => (
                    <div key={a.id} style={{padding:'8px 12px', display:'flex', alignItems:'center', gap:10, background:'#F7F9FC', border:'1px solid #EEF2F7', borderRadius:8}}>
                      <Chip color={a.scope_all ? '#C2261D' : a.department_id ? '#0072FF' : a.sub_department_id ? '#17A674' : a.manager_id ? '#E08A1E' : '#8A97A8'}>
                        {a.scope_all ? 'ALL' : a.department_id ? 'DEPT' : a.sub_department_id ? 'SUB' : a.manager_id ? 'MGR' : 'EMP'}
                      </Chip>
                      <div style={{flex:1, fontSize:13, color:'#0A1F3D', fontWeight:600}}>{labelFor(a)}</div>
                      <button onClick={() => removeAssignment(a)} disabled={busy} style={{padding:'4px 10px', background:'#fff', border:'1px solid #FCE1DE', borderRadius:6, fontSize:11, fontWeight:700, color:'#C2261D', cursor: busy ? 'not-allowed' : 'pointer'}}>Remove</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Add new scopes — only NOT-yet-assigned items shown */}
            {isCurrentlyScopeAll ? (
              <div style={{padding:14, background:'#FFF6E6', border:'1px solid #FCD79B', borderRadius:8, fontSize:13, color:'#9A6708', fontWeight:600}}>
                ⚠️ This course is assigned to <strong>All employees</strong>. There's nothing more to add. Remove the "ALL" scope above first if you want to switch to selective scopes.
              </div>
            ) : (
              <>
                <div style={{marginBottom:10}}>
                  <div className="eyebrow">ADD MORE SCOPES</div>
                  <div style={{fontSize:12, color:'#5B6A7D', marginTop:4}}>Pick from the lists below — already-assigned items are hidden automatically.</div>
                </div>
                <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12}}>
                  <PickerGroup label={`Departments (${addDeptIds.length})`} options={availableDepts.map(d => ({ id: d.id, label: d.name }))} selected={addDeptIds} onToggle={(id)=>toggle(addDeptIds, setAddDeptIds, id)} searchable/>
                  <PickerGroup label={`Sub-departments (${addSubDeptIds.length})`} options={availableSubDepts.map(s => ({ id: s.id, label: s.name }))} selected={addSubDeptIds} onToggle={(id)=>toggle(addSubDeptIds, setAddSubDeptIds, id)} searchable/>
                  <PickerGroup label={`Managers (${addManagerIds.length})`} options={availableManagers.map(m => ({ id: m.id, label: m.name || m.email }))} selected={addManagerIds} onToggle={(id)=>toggle(addManagerIds, setAddManagerIds, id)} searchable/>
                  <PickerGroup label={`Designation (${addDesignationNames.length})`} options={designationOptions.map(d => ({ id: d, label: d }))} selected={addDesignationNames} onToggle={(id)=>toggle(addDesignationNames, setAddDesignationNames, id)} searchable/>
                  <PickerGroup label={`Specific employees (${addEmployeeIds.length})`} options={availableEmployees.map(e => ({ id: e.id, label: e.name || e.email }))} selected={addEmployeeIds} onToggle={(id)=>toggle(addEmployeeIds, setAddEmployeeIds, id)} searchable/>
                </div>
              </>
            )}

            {err && <div style={{marginTop:14, padding:'10px 12px', background:'#FCE1DE', color:'#C2261D', borderRadius:8, fontSize:13, fontWeight:500}}>{err}</div>}
          </div>
        )}

        <div style={{padding:'14px 22px', borderTop:'1px solid #EEF2F7', display:'flex', gap:10, justifyContent:'flex-end'}}>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn variant="success" disabled={!anyToAdd || busy || isCurrentlyScopeAll} onClick={save}>{busy ? 'Saving…' : `Add ${anyToAdd ? `(${addDeptIds.length + addSubDeptIds.length + addManagerIds.length + addEmployeeIds.length})` : ''}`}</Btn>
        </div>
      </div>
    </div>
  );
}

function PickerGroup({ label, options, selected, onToggle, searchable }: { label: string; options: { id: string; label: string }[]; selected: string[]; onToggle: (id: string) => void; searchable?: boolean }) {
  const [q, setQ] = useState('');
  const filtered = q ? options.filter(o => o.label.toLowerCase().includes(q.toLowerCase())) : options;
  return (
    <div style={{border:'1px solid #EEF2F7', borderRadius:10, background:'#fff', overflow:'hidden'}}>
      <div style={{padding:'10px 12px', borderBottom:'1px solid #EEF2F7', fontSize:12, fontWeight:700, color:'#3B4A5E', display:'flex', alignItems:'center', gap:8}}>
        <span>{label}</span>
        {searchable && (
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search…" style={{marginLeft:'auto', padding:'4px 8px', border:'1px solid #DDE4ED', borderRadius:6, fontSize:11, width:120, outline:'none'}}/>
        )}
      </div>
      <div style={{maxHeight:160, overflowY:'auto', padding:'4px 8px'}}>
        {filtered.length === 0 ? (
          <div style={{padding:'10px 4px', fontSize:11, color:'#8A97A8'}}>{options.length === 0 ? 'All options already assigned.' : 'No matches.'}</div>
        ) : filtered.map(opt => (
          <label key={opt.id} style={{display:'flex', alignItems:'center', gap:8, padding:'6px 4px', cursor:'pointer', fontSize:12, color:'#3B4A5E', borderRadius:4}}>
            <input type="checkbox" checked={selected.includes(opt.id)} onChange={()=>onToggle(opt.id)}/>
            <span>{opt.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
