import React, { useEffect, useState, type CSSProperties } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./auth";
import { Btn, Card, Chip, Icon } from "./ui";
import type { Nav } from "./App";

const inputStyle: CSSProperties = { padding:'10px 12px', border:'1px solid #DDE4ED', borderRadius:8, fontSize:14, outline:'none', background:'#fff', fontFamily:'inherit' };

function TInput(p: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} style={{...inputStyle, width:'100%', ...(p.style||{})}}/>;
}
function Label({ children, style }: { children: React.ReactNode; style?: CSSProperties }) {
  return <div style={{fontSize:12, fontWeight:700, color:'#3B4A5E', marginBottom:6, ...style}}>{children}</div>;
}

type Q = { q: string; options: string[]; correct: number; hint: string };

const TAGS = ['Mandatory','Soft Skills','Leadership','Culture','Business','General'];
const HUES = ['#0072FF','#17A674','#E08A1E','#A855F7','#EC4899','#134594'];
const EMOJIS = ['📘','🛡️','💬','🎯','🤝','📊','🔐','🎓'];

export function AdminUpload({ onNav }: { onNav: Nav }) {
  const { user } = useAuth();
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState<'new'|'existing'>('new');

  const [existingCourses, setExistingCourses] = useState<{ id:string; title:string }[]>([]);
  const [existingCourseId, setExistingCourseId] = useState('');

  const [courseTitle, setCourseTitle] = useState('');
  const [tag, setTag] = useState('Mandatory');
  const [hue, setHue] = useState(HUES[0]);
  const [emoji, setEmoji] = useState(EMOJIS[0]);
  const [blurb, setBlurb] = useState('');

  const [lessonTitle, setLessonTitle] = useState('');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [uploadPct, setUploadPct] = useState(0);

  const [questions, setQuestions] = useState<Q[]>([]);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ----- Assignment picker state -----
  type Dept = { id: string; name: string };
  type SubDept = { id: string; name: string; department_id: string };
  type EmpOpt = { id: string; name: string; email: string; department_id: string | null; sub_department_id: string | null; manager_id: string | null; designation_name: string | null; is_manager: boolean };
  const [assignAll, setAssignAll] = useState(true);
  const [assignDeptIds, setAssignDeptIds] = useState<string[]>([]);
  const [assignSubDeptIds, setAssignSubDeptIds] = useState<string[]>([]);
  const [assignManagerIds, setAssignManagerIds] = useState<string[]>([]);
  const [assignEmployeeIds, setAssignEmployeeIds] = useState<string[]>([]);
  const [assignDesignationNames, setAssignDesignationNames] = useState<string[]>([]);
  const [departments, setDepartments] = useState<Dept[]>([]);
  const [subDepartments, setSubDepartments] = useState<SubDept[]>([]);
  const [employeesAll, setEmployeesAll] = useState<EmpOpt[]>([]);

  useEffect(() => {
    (async () => {
      // Supabase JS caps single queries at 1000 rows by default. With 3000+
      // employees that hides 2/3 of the org from the picker (the symptom you
      // hit: manager appeared to have 14 reports when DB had 16). Page through
      // 1000-row chunks until we've fetched everything.
      type Row = Omit<EmpOpt, 'is_manager'>;
      const fetchAllEmployees = async (): Promise<Row[]> => {
        const all: Row[] = [];
        const page = 1000;
        for (let from = 0; ; from += page) {
          const { data, error } = await supabase
            .from('employees')
            .select('id, name, email, department_id, sub_department_id, manager_id, designation_name, status')
            .eq('status', 'active')
            .order('name', { ascending: true })
            .range(from, from + page - 1);
          if (error) { console.warn('[AdminUpload] employee paging stopped:', error.message); break; }
          if (!data || data.length === 0) break;
          all.push(...(data as Row[]));
          if (data.length < page) break;
        }
        return all;
      };

      const [{ data: d }, { data: s }, allEmployees] = await Promise.all([
        supabase.from('departments').select('id, name').order('name').range(0, 9999),
        supabase.from('sub_departments').select('id, name, department_id').order('name').range(0, 9999),
        fetchAllEmployees(),
      ]);
      setDepartments((d || []) as Dept[]);
      setSubDepartments((s || []) as SubDept[]);
      // A "manager" is anyone in the active set who has at least one direct
      // report — derived from the same paged list so we never miss reports.
      const reportCounts = new Map<string, number>();
      allEmployees.forEach((row) => {
        if (!row.manager_id) return;
        reportCounts.set(row.manager_id, (reportCounts.get(row.manager_id) ?? 0) + 1);
      });
      setEmployeesAll(allEmployees.map(emp => ({
        ...emp,
        designation_name: (emp as Record<string, unknown>).designation_name as string | null ?? null,
        is_manager: (reportCounts.get(emp.id) ?? 0) > 0,
      })));
    })();
  }, []);

  const filteredSubDepts = subDepartments.filter(s => assignDeptIds.length === 0 || assignDeptIds.includes(s.department_id));

  // Managers: filter by where THEIR REPORTS work, not by the manager's own
  // department. Picking "HR" should show every manager who has at least one
  // report in HR — even if that manager themselves sits in another dept.
  // This was the bug behind "filters mismatching with managers".
  const managerOptions = (() => {
    const deptSet = new Set(assignDeptIds);
    const subDeptSet = new Set(assignSubDeptIds);
    const noTreeFilter = deptSet.size === 0 && subDeptSet.size === 0;
    // Build manager_id -> [reports] index from the employees set.
    const reportsByManager = new Map<string, EmpOpt[]>();
    employeesAll.forEach(e => {
      if (!e.manager_id) return;
      const arr = reportsByManager.get(e.manager_id) ?? [];
      arr.push(e);
      reportsByManager.set(e.manager_id, arr);
    });
    return employeesAll.filter(m => {
      if (!m.is_manager) return false;
      if (noTreeFilter) return true;
      const reports = reportsByManager.get(m.id) ?? [];
      // Show this manager if AT LEAST one of their reports matches BOTH
      // selected dept AND selected sub-dept (intersection on each report).
      return reports.some(r => {
        if (deptSet.size && (!r.department_id || !deptSet.has(r.department_id))) return false;
        if (subDeptSet.size && (!r.sub_department_id || !subDeptSet.has(r.sub_department_id))) return false;
        return true;
      });
    });
  })();

  // Designation options: filtered by current dept/subdept/manager selection.
  const designationOptions = Array.from(
    new Set(
      employeesAll
        .filter(e => {
          if (assignDeptIds.length && (!e.department_id || !assignDeptIds.includes(e.department_id))) return false;
          if (assignSubDeptIds.length && (!e.sub_department_id || !assignSubDeptIds.includes(e.sub_department_id))) return false;
          if (assignManagerIds.length && (!e.manager_id || !assignManagerIds.includes(e.manager_id))) return false;
          return true;
        })
        .map(e => e.designation_name)
        .filter((d): d is string => !!d)
    )
  ).sort();

  // Specific-employees list: each row must satisfy ALL active filters.
  const employeeOptions = employeesAll.filter(e => {
    if (assignDeptIds.length && (!e.department_id || !assignDeptIds.includes(e.department_id))) return false;
    if (assignSubDeptIds.length && (!e.sub_department_id || !assignSubDeptIds.includes(e.sub_department_id))) return false;
    if (assignManagerIds.length && (!e.manager_id || !assignManagerIds.includes(e.manager_id))) return false;
    if (assignDesignationNames.length && (!e.designation_name || !assignDesignationNames.includes(e.designation_name))) return false;
    return true;
  });
  useEffect(() => {
    const allowedSubIds = new Set(filteredSubDepts.map(s => s.id));
    setAssignSubDeptIds(prev => {
      const next = prev.filter(id => allowedSubIds.has(id));
      return next.length === prev.length && next.every((v, i) => v === prev[i]) ? prev : next;
    });
  }, [assignDeptIds, filteredSubDepts]);
  useEffect(() => {
    const allowedManagerIds = new Set(managerOptions.map(m => m.id));
    setAssignManagerIds(prev => {
      const next = prev.filter(id => allowedManagerIds.has(id));
      return next.length === prev.length && next.every((v, i) => v === prev[i]) ? prev : next;
    });
  }, [assignDeptIds, assignSubDeptIds, managerOptions]);
  useEffect(() => {
    const allowedEmployeeIds = new Set(employeeOptions.map(e => e.id));
    setAssignEmployeeIds(prev => {
      const next = prev.filter(id => allowedEmployeeIds.has(id));
      return next.length === prev.length && next.every((v, i) => v === prev[i]) ? prev : next;
    });
  }, [assignDeptIds, assignSubDeptIds, assignManagerIds, assignDesignationNames, employeeOptions]);
  // Clear designation selections when dept/subdept/manager filter changes.
  useEffect(() => {
    const allowed = new Set(designationOptions);
    setAssignDesignationNames(prev => prev.filter(d => allowed.has(d)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignDeptIds, assignSubDeptIds, assignManagerIds]);
  const toggle = (arr: string[], setArr: (v: string[]) => void, id: string) => {
    setArr(arr.includes(id) ? arr.filter(x => x !== id) : [...arr, id]);
  };
  const assignmentValid = assignAll
    || assignDeptIds.length > 0
    || assignSubDeptIds.length > 0
    || assignManagerIds.length > 0
    || assignDesignationNames.length > 0
    || assignEmployeeIds.length > 0;

  // Resolve the assignment into the actual employee set using INTERSECTION
  // semantics for the org-tree filters: each more-specific level NARROWS the
  // previous. So picking "HR + HRBP sub-dept" gives only HRBP people, not
  // all of HR. Specific-employee picks are additive (union) on top of that.
  //
  // This matches what the user expects from a cascading filter UI and
  // prevents the "I picked HRBP but everyone in HR got assigned" bug.
  const resolvedEmployeeIds: Set<string> = (() => {
    const out = new Set<string>();
    if (!assignmentValid) return out;
    if (assignAll) {
      employeesAll.forEach(e => out.add(e.id));
      return out;
    }
    // When specific employees are selected, the dept/subdept/manager picks
    // are just cascading UI filters — ONLY the checked employees matter.
    if (assignEmployeeIds.length > 0) {
      assignEmployeeIds.forEach(id => out.add(id));
      return out;
    }
    // No specific employees — use the tree filter intersection (incl. designation).
    const usingTreeFilter = assignDeptIds.length > 0 || assignSubDeptIds.length > 0 || assignManagerIds.length > 0 || assignDesignationNames.length > 0;
    if (usingTreeFilter) {
      employeesAll.forEach(e => {
        if (assignDeptIds.length > 0    && (!e.department_id     || !assignDeptIds.includes(e.department_id)))     return;
        if (assignSubDeptIds.length > 0 && (!e.sub_department_id || !assignSubDeptIds.includes(e.sub_department_id))) return;
        if (assignManagerIds.length > 0 && (!e.manager_id        || !assignManagerIds.includes(e.manager_id)))     return;
        if (assignDesignationNames.length > 0 && (!e.designation_name || !assignDesignationNames.includes(e.designation_name))) return;
        out.add(e.id);
      });
    }
    return out;
  })();
  const previewEmployeeCount = resolvedEmployeeIds.size;

  useEffect(() => {
    supabase.from('courses').select('id, title').order('created_at', { ascending: true }).then(({ data }) => setExistingCourses(data || []));
  }, []);

  // Read duration from chosen file
  const onPickVideo = (f: File | null) => {
    setVideoFile(f);
    setVideoDuration(0);
    if (!f) return;
    const url = URL.createObjectURL(f);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => { setVideoDuration(Math.round(v.duration || 0)); URL.revokeObjectURL(url); };
    v.src = url;
  };

  const q = questions[active];
  const update = (patch: Partial<Q>) => { const c=[...questions]; c[active]={...c[active], ...patch}; setQuestions(c); };
  const updateOpt = (i: number, v: string) => { const opts=[...q.options]; opts[i]=v; update({ options: opts }); };
  const removeQ = (idx: number) => {
    const c = questions.filter((_,i) => i !== idx); setQuestions(c);
    if (active >= c.length) setActive(Math.max(0, c.length - 1));
  };

  const onPickQuiz = async (f: File | null) => {
    if (!f) return;
    setParseError(null); setParsing(true);
    try {
      const buf = await f.arrayBuffer();
      // safe base64 for large files
      let bin = ''; const bytes = new Uint8Array(buf);
      const chunk = 0x8000;
      for (let i=0;i<bytes.length;i+=chunk) bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i+chunk)));
      const b64 = btoa(bin);
      const { data, error } = await supabase.functions.invoke('parse-quiz', {
        body: { fileBase64: b64, mimeType: f.type || 'application/octet-stream', fileName: f.name },
      });
      if (error) {
        // supabase-js wraps non-2xx responses into a generic error message.
        // Try to extract the actual response payload/status for a helpful UI message.
        const anyErr = error as unknown as {
          message?: string;
          context?: { status?: number; body?: unknown };
        };
        const status = anyErr?.context?.status;
        const body = anyErr?.context?.body as any;
        const bodyMsg =
          typeof body === 'string'
            ? body
            : (body && typeof body === 'object' && typeof body.error === 'string')
              ? body.error
              : null;
        if (status === 503) throw new Error(bodyMsg || 'AI is under high demand right now. Please retry in 30–60 seconds.');
        if (status === 429) throw new Error(bodyMsg || 'Too many requests. Please wait a moment and retry.');
        throw new Error(bodyMsg || anyErr?.message || 'Failed to parse assessment. Please try again.');
      }
      const parsed = (data?.questions as Q[]) || [];
      if (!parsed.length) throw new Error('AI could not find any questions in this file.');
      setQuestions(parsed);
      setActive(0);
    } catch (e) {
      setParseError((e as Error).message || 'Failed to parse questions');
    } finally { setParsing(false); }
  };

  const publish = async () => {
    setSaving(true); setError(null);
    try {
      if (!videoFile) throw new Error('Please upload a video file (mandatory).');
      let courseId = existingCourseId;
      if (mode === 'new') {
        if (!courseTitle.trim()) throw new Error('Course title is required.');
        const { data, error: e1 } = await supabase.from('courses').insert({
          title: courseTitle.trim(), tag, blurb, instructor: '', hue, emoji,
          duration_label: videoDuration ? `${Math.ceil(videoDuration/60)} min` : '',
          created_by: user?.id ?? null,
          published_at: new Date().toISOString(),
        }).select('id').single();
        if (e1) throw e1;
        courseId = data.id;
      }
      if (!courseId) throw new Error('Pick or create a course.');
      if (!lessonTitle.trim()) throw new Error('Lesson title is required.');

      // Upload video
      const ext = videoFile.name.split('.').pop() || 'mp4';
      const path = `${courseId}/${crypto.randomUUID()}.${ext}`;
      setUploadPct(10);
      const { error: upErr } = await supabase.storage.from('course-videos').upload(path, videoFile, { upsert: false, contentType: videoFile.type });
      if (upErr) throw upErr;
      setUploadPct(80);

      const { count } = await supabase.from('lessons').select('id', { count: 'exact', head: true }).eq('course_id', courseId);
      const position = count ?? 0;

      const dur = videoDuration || 360;
      const { data: lesson, error: e2 } = await supabase.from('lessons').insert({
        course_id: courseId, title: lessonTitle.trim(), duration_seconds: dur,
        video_path: path, position,
      }).select('id').single();
      if (e2) throw e2;

      const valid = questions.filter(qq => qq.q.trim() && qq.options.every(o => o.trim()));
      if (valid.length) {
        const rows = valid.map((qq, i) => ({
          lesson_id: lesson.id, question: qq.q.trim(), options: qq.options.map(o => o.trim()),
          correct_index: qq.correct, hint: qq.hint, position: i,
        }));
        const { error: e3 } = await supabase.from('mcq_questions').insert(rows);
        if (e3) throw e3;
      }

      // ----- Write course_assignments for the picker selections.
      // For new courses, we always write fresh rows. For existing courses we
      // additionally clear prior assignments so the admin can re-target.
      if (mode === 'new' || (mode === 'existing' && assignmentValid)) {
        if (mode === 'existing') {
          await supabase.from('course_assignments').delete().eq('course_id', courseId);
        }
        const rows: Record<string, unknown>[] = [];
        if (assignAll) {
          rows.push({ course_id: courseId, scope_all: true });
        } else {
          // ---- Intersection-based assignment ----
          // INTENT: each more-specific level narrows. Pick HR + HRBP →
          // only HRBP people get assigned, not all of HR.
          //
          // The DB's assigned_employees() function OR-combines rows. So to
          // express intersection we have two strategies:
          //
          //   1. SINGLE LEVEL picked (e.g. only depts, or only managers) →
          //      write rows for that level. The DB resolver expands them at
          //      query time, which preserves auto-enrollment for new joiners.
          //
          //   2. MULTIPLE LEVELS picked (e.g. dept + sub-dept, or sub-dept +
          //      manager) → resolve the intersection in the client and write
          //      ONE employee_id row per resolved person. This is a snapshot:
          //      new joiners matching the same scope won't auto-enroll. The
          //      preview count under the picker tells the admin exactly what
          //      they're committing to.
          const usingDept = assignDeptIds.length > 0;
          const usingSub = assignSubDeptIds.length > 0;
          const usingMgr = assignManagerIds.length > 0;
          const usingDesig = assignDesignationNames.length > 0;
          const usingEmp = assignEmployeeIds.length > 0;

          if (usingEmp) {
            // Specific employees → only assign those (all other filters are UI cascade only).
            assignEmployeeIds.forEach(id => rows.push({ course_id: courseId, employee_id: id }));
          } else if (!usingDept && !usingSub && !usingMgr && !usingDesig) {
            // Should not happen (assignmentValid guard above), but be safe.
          } else if (!usingDept && !usingSub && !usingDesig && usingMgr) {
            // Single tree level: manager only → write manager scope rows (auto-enroll future reports).
            assignManagerIds.forEach(id => rows.push({ course_id: courseId, manager_id: id }));
          } else if (!usingSub && !usingMgr && !usingDesig && usingDept) {
            // Single tree level: dept only → write dept scope rows (auto-enroll future joiners).
            assignDeptIds.forEach(id => rows.push({ course_id: courseId, department_id: id }));
          } else if (!usingDept && !usingMgr && !usingDesig && usingSub) {
            // Single tree level: sub-dept only.
            assignSubDeptIds.forEach(id => rows.push({ course_id: courseId, sub_department_id: id }));
          } else {
            // Mixed filters (incl. designation) → snapshot the intersection as employee_id rows.
            resolvedEmployeeIds.forEach(id => rows.push({ course_id: courseId, employee_id: id }));
          }
        }
        if (rows.length) {
          const { error: e4 } = await supabase.from('course_assignments').insert(rows);
          if (e4) throw e4;
        }

        // Ensure enrollments are refreshed immediately even if DB triggers
        // were not applied on this project (safe no-op if function missing).
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase as any).rpc?.('refresh_enrollments_for_course', { _course_id: courseId });
        } catch {
          // ignore – DB function may not exist on legacy schema
        }
      }
      // If existing course, also push a notification (publish trigger only fires on new course).
      if (mode === 'existing') {
        const { data: ps } = await supabase.from('employees').select('auth_user_id').not('auth_user_id', 'is', null);
        if (ps && ps.length) {
          await supabase.from('notifications').insert(ps.map((p: { auth_user_id: string }) => ({
            user_id: p.auth_user_id, title: 'New lesson added', body: `${lessonTitle.trim()} — open course to watch`, link_course_id: courseId,
          })));
        }
      }
      setUploadPct(100);
      setSaving(false);
      onNav('admin-dashboard');
    } catch (err) {
      const msg = (err as Error).message || '';
      if (msg.includes('row-level security policy for table "courses"')) {
        setError('You are not passing admin DB policy. Please apply the admin-role compatibility SQL patch, then retry publish.');
      } else {
        setError(msg);
      }
      setSaving(false);
    }
  };

  return (
    <div style={{padding:'28px 36px 48px', animation:'fadeUp .3s'}}>
      <div style={{display:'grid', gridTemplateColumns:'1fr 320px', gap:20}}>
        <div>
          <div style={{display:'flex', alignItems:'center', gap:10, marginBottom:20}}>
            {([[1,'Course'],[2,'Video'],[3,'Quiz'],[4,'Publish']] as const).map(([n,l],i,arr) => (
              <React.Fragment key={n}>
                <button onClick={()=>setStep(n)} style={{display:'flex', alignItems:'center', gap:10, background:'transparent', border:0, cursor:'pointer', padding:0}}>
                  <div style={{width:32, height:32, borderRadius:99, background: step>=n?'linear-gradient(135deg,#00C6FF,#0072FF)':'#EEF2F7', color: step>=n?'#fff':'#8A97A8', display:'grid', placeItems:'center', fontWeight:800, fontSize:13}}>{step>n?'✓':n}</div>
                  <div style={{fontSize:13, fontWeight: step===n?700:500, color: step===n?'#002A4B':'#5B6A7D'}}>{l}</div>
                </button>
                {i<arr.length-1 && <div style={{flex:1, maxWidth:50, height:2, background: step>n?'#0072FF':'#EEF2F7'}}/>}
              </React.Fragment>
            ))}
          </div>

          {step===1 && (
            <Card pad={0}>
              <div style={{padding:24, borderBottom:'1px solid #EEF2F7'}}>
                <h3 style={{fontSize:18, color:'#002A4B', margin:0, fontWeight:800}}>Pick a course</h3>
                <div style={{fontSize:13, color:'#5B6A7D', marginTop:4}}>Add a video to an existing course or create a new one.</div>
              </div>
              <div style={{padding:24}}>
                <div style={{display:'flex', gap:8, marginBottom:18}}>
                  <button onClick={()=>setMode('new')} style={{flex:1, padding:'12px 14px', borderRadius:10, border:`1.5px solid ${mode==='new'?'#0072FF':'#EEF2F7'}`, background: mode==='new'?'#F2F9FF':'#fff', textAlign:'left', cursor:'pointer'}}>
                    <div style={{fontSize:13, fontWeight:700, color:'#002A4B'}}>+ New course</div>
                    <div style={{fontSize:12, color:'#5B6A7D'}}>Auto-assigned to all employees on publish.</div>
                  </button>
                  <button onClick={()=>setMode('existing')} disabled={existingCourses.length===0} style={{flex:1, padding:'12px 14px', borderRadius:10, border:`1.5px solid ${mode==='existing'?'#0072FF':'#EEF2F7'}`, background: mode==='existing'?'#F2F9FF':'#fff', textAlign:'left', cursor: existingCourses.length?'pointer':'not-allowed', opacity: existingCourses.length?1:.5}}>
                    <div style={{fontSize:13, fontWeight:700, color:'#002A4B'}}>Add to existing</div>
                    <div style={{fontSize:12, color:'#5B6A7D'}}>{existingCourses.length} course{existingCourses.length===1?'':'s'} available.</div>
                  </button>
                </div>

                {mode === 'existing' ? (
                  <div>
                    <Label>Course</Label>
                    <select value={existingCourseId} onChange={e=>setExistingCourseId(e.target.value)} style={{...inputStyle, width:'100%'}}>
                      <option value="">— Pick a course —</option>
                      {existingCourses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                    </select>
                  </div>
                ) : (
                  <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:14}}>
                    <div style={{gridColumn:'1 / -1'}}><Label>Title</Label><TInput value={courseTitle} onChange={e=>setCourseTitle(e.target.value)} placeholder="POSH Awareness at Workplace"/></div>
                    <div><Label>Tag</Label><select value={tag} onChange={e=>setTag(e.target.value)} style={{...inputStyle, width:'100%'}}>{TAGS.map(t=><option key={t}>{t}</option>)}</select></div>
                    <div><Label>Color</Label><div style={{display:'flex', gap:6}}>{HUES.map(h=><button key={h} onClick={()=>setHue(h)} style={{width:30, height:30, borderRadius:8, background:h, border: hue===h?'3px solid #002A4B':'2px solid #fff', cursor:'pointer'}}/>)}</div></div>
                    <div style={{gridColumn:'1 / -1'}}><Label>Emoji</Label><div style={{display:'flex', gap:6, flexWrap:'wrap'}}>{EMOJIS.map(e=><button key={e} onClick={()=>setEmoji(e)} style={{width:36, height:36, borderRadius:8, fontSize:18, background: emoji===e?'#F2F9FF':'#fff', border:`1.5px solid ${emoji===e?'#0072FF':'#EEF2F7'}`, cursor:'pointer'}}>{e}</button>)}</div></div>
                    <div style={{gridColumn:'1 / -1'}}><Label>Description</Label><textarea rows={3} value={blurb} onChange={e=>setBlurb(e.target.value)} style={{...inputStyle, width:'100%', resize:'vertical'}} placeholder="Short summary shown on the course card."/></div>
                  </div>
                )}
              </div>
              <div style={{padding:'14px 24px', borderTop:'1px solid #EEF2F7', display:'flex', justifyContent:'flex-end'}}>
                <Btn onClick={()=>setStep(2)} disabled={mode==='existing' ? !existingCourseId : !courseTitle.trim()}>Next — Video →</Btn>
              </div>
            </Card>
          )}

          {step===2 && (
            <Card pad={0}>
              <div style={{padding:24, borderBottom:'1px solid #EEF2F7'}}>
                <h3 style={{fontSize:18, color:'#002A4B', margin:0, fontWeight:800}}>Upload the video <span style={{color:'#C2261D'}}>*</span></h3>
                <div style={{fontSize:13, color:'#5B6A7D', marginTop:4}}>MP4/WebM file. Watch duration is tracked per learner so you'll know who actually watched.</div>
              </div>
              <div style={{padding:24, display:'grid', gridTemplateColumns:'1fr 1fr', gap:14}}>
                <div style={{gridColumn:'1 / -1'}}><Label>Video title</Label><TInput value={lessonTitle} onChange={e=>setLessonTitle(e.target.value)} placeholder="What POSH means — your rights at work"/></div>
                <div style={{gridColumn:'1 / -1'}}>
                  <Label>Video file (mandatory)</Label>
                  <label style={{display:'block', padding:24, border:`2px dashed ${videoFile?'#17A674':'#CCEAFF'}`, background: videoFile?'#F0FCF5':'#F7FBFF', borderRadius:12, cursor:'pointer', textAlign:'center'}}>
                    <input type="file" accept="video/*" style={{display:'none'}} onChange={e=>onPickVideo(e.target.files?.[0] || null)}/>
                    {videoFile ? (
                      <div>
                        <div style={{fontSize:32, marginBottom:6}}>🎬</div>
                        <div style={{fontSize:14, fontWeight:700, color:'#0A1F3D'}}>{videoFile.name}</div>
                        <div style={{fontSize:12, color:'#5B6A7D', marginTop:4}}>{(videoFile.size/1024/1024).toFixed(1)} MB · {videoDuration ? `${Math.floor(videoDuration/60)}m ${videoDuration%60}s` : 'reading…'}</div>
                        <div style={{marginTop:10, fontSize:12, color:'#0072FF', fontWeight:600}}>Click to change</div>
                      </div>
                    ) : (
                      <div>
                        <div style={{fontSize:32, marginBottom:6}}>📤</div>
                        <div style={{fontSize:14, fontWeight:700, color:'#0A1F3D'}}>Click to choose a video file</div>
                        <div style={{fontSize:12, color:'#5B6A7D', marginTop:4}}>External links are not supported — uploads only</div>
                      </div>
                    )}
                  </label>
                </div>
              </div>
              <div style={{padding:'14px 24px', borderTop:'1px solid #EEF2F7', display:'flex', justifyContent:'space-between'}}>
                <Btn variant="ghost" onClick={()=>setStep(1)}>← Back</Btn>
                <Btn onClick={()=>setStep(3)} disabled={!lessonTitle.trim() || !videoFile}>Next — Quiz →</Btn>
              </div>
            </Card>
          )}

          {step===3 && (
            <Card pad={0}>
              <div style={{padding:'20px 24px', borderBottom:'1px solid #EEF2F7'}}>
                <h3 style={{fontSize:18, color:'#002A4B', margin:0, fontWeight:800}}>Upload assessment</h3>
                <div style={{fontSize:13, color:'#5B6A7D', marginTop:4}}>Upload a PDF, DOCX or TXT with questions, options & correct answers. AI will parse it automatically.</div>
              </div>
              <div style={{padding:24}}>
                <label style={{display:'block', padding:24, border:'2px dashed #CCEAFF', background:'#F7FBFF', borderRadius:12, cursor: parsing?'wait':'pointer', textAlign:'center', opacity: parsing?.7:1}}>
                  <input type="file" accept=".pdf,.docx,.doc,.txt" style={{display:'none'}} disabled={parsing} onChange={e=>onPickQuiz(e.target.files?.[0] || null)}/>
                  <div style={{fontSize:32, marginBottom:6}}>{parsing ? '🤖' : '📄'}</div>
                  <div style={{fontSize:14, fontWeight:700, color:'#0A1F3D'}}>{parsing ? 'AI is reading your file…' : 'Click to upload a PDF/DOCX/TXT'}</div>
                  <div style={{fontSize:12, color:'#5B6A7D', marginTop:4}}>Format freely — write Q1, A) B) C) D), and mark the answer.</div>
                </label>
                {parseError && <div style={{marginTop:12, padding:'10px 12px', background:'#FCE1DE', color:'#C2261D', borderRadius:8, fontSize:13, fontWeight:500}}>{parseError}</div>}

                {questions.length > 0 && (
                  <div style={{marginTop:20}}>
                    <div style={{display:'flex', alignItems:'center', marginBottom:12}}>
                      <Chip color="#17A674">✓ {questions.length} question{questions.length===1?'':'s'} parsed</Chip>
                      <div style={{marginLeft:'auto', fontSize:12, color:'#5B6A7D'}}>Click any question to review/edit before publishing.</div>
                    </div>
                    <div style={{display:'grid', gridTemplateColumns:'220px 1fr', border:'1px solid #EEF2F7', borderRadius:12, overflow:'hidden'}}>
                      <div style={{borderRight:'1px solid #EEF2F7', padding:'10px 8px', maxHeight:480, overflowY:'auto', background:'#FAFBFE'}}>
                        {questions.map((qq,i) => (
                          <div key={i} style={{display:'flex', marginBottom:4}}>
                            <button onClick={()=>setActive(i)} style={{flex:1, display:'flex', gap:10, padding:'9px 10px', textAlign:'left', background: active===i?'#fff':'transparent', border: active===i?'1px solid #CCEAFF':'1px solid transparent', borderRadius:9, cursor:'pointer', alignItems:'flex-start'}}>
                              <div style={{width:22, height:22, borderRadius:6, background: active===i?'#0072FF':'#EEF2F7', color: active===i?'#fff':'#5B6A7D', display:'grid', placeItems:'center', fontWeight:800, fontSize:11, flexShrink:0}}>{i+1}</div>
                              <div style={{fontSize:12, color:'#3B4A5E', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1, minWidth:0}}>{qq.q}</div>
                            </button>
                            <button onClick={()=>removeQ(i)} style={{width:26, background:'transparent', border:0, color:'#BCC6D3', cursor:'pointer', fontSize:13}}>✕</button>
                          </div>
                        ))}
                      </div>
                      <div style={{padding:18}}>
                        {q && <>
                          <Label>Question</Label>
                          <textarea rows={2} value={q.q} onChange={e=>update({q:e.target.value})} style={{...inputStyle, width:'100%', fontSize:14, color:'#002A4B', resize:'vertical'}}/>
                          <Label style={{marginTop:12}}>Options · <span style={{color:'#17A674'}}>green = correct</span></Label>
                          <div style={{display:'flex', flexDirection:'column', gap:6}}>
                            {q.options.map((opt,i) => (
                              <div key={i} style={{display:'flex', gap:8, padding:'8px 10px', border:`1.5px solid ${q.correct===i?'#17A674':'#EEF2F7'}`, background: q.correct===i?'#F0FCF5':'#fff', borderRadius:8, alignItems:'center'}}>
                                <button onClick={()=>update({correct:i})} style={{width:22, height:22, borderRadius:99, background: q.correct===i?'#17A674':'#EEF2F7', color: q.correct===i?'#fff':'#8A97A8', border:0, cursor:'pointer', fontSize:11, fontWeight:800, flexShrink:0}}>{q.correct===i?'✓':String.fromCharCode(65+i)}</button>
                                <input value={opt} onChange={e=>updateOpt(i, e.target.value)} style={{flex:1, border:0, outline:'none', fontSize:13, background:'transparent'}}/>
                              </div>
                            ))}
                          </div>
                        </>}
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <div style={{padding:'14px 24px', borderTop:'1px solid #EEF2F7', display:'flex', justifyContent:'space-between'}}>
                <Btn variant="ghost" onClick={()=>setStep(2)}>← Back</Btn>
                <Btn onClick={()=>setStep(4)} disabled={questions.length===0}>Next — Publish →</Btn>
              </div>
            </Card>
          )}

          {step===4 && (
            <Card pad={0}>
              <div style={{padding:40, textAlign:'center', background:'linear-gradient(180deg,#F2F9FF,#fff)', borderBottom:'1px solid #EEF2F7'}}>
                <div style={{width:72, height:72, margin:'0 auto', borderRadius:20, background:'linear-gradient(135deg,#17A674,#0E6E4A)', display:'grid', placeItems:'center', boxShadow:'0 10px 30px rgba(23,166,116,.3)'}}><Icon d="M5 13l4 4L19 7" size={32} color="#fff" stroke={3}/></div>
                <div style={{fontSize:24, fontWeight:800, color:'#002A4B', marginTop:16, letterSpacing:'-.02em'}}>Ready to publish.</div>
                <div style={{fontSize:14, color:'#5B6A7D', marginTop:4}}>Auto-assigned to every employee. They'll get a notification.</div>
              </div>
              <div style={{padding:24}}>
                <div style={{marginBottom:18, padding:16, border:'1px solid #EEF2F7', borderRadius:12, background:'#FAFBFD'}}>
                  <div style={{display:'flex', alignItems:'center', marginBottom:12}}>
                    <div>
                      <div className="eyebrow">ASSIGN COURSE TO</div>
                      <div style={{fontSize:14, fontWeight:700, color:'#0A1F3D', marginTop:2}}>Pick who can see and complete this course</div>
                    </div>
                    <label style={{marginLeft:'auto', display:'flex', alignItems:'center', gap:8, cursor:'pointer', padding:'8px 12px', background: assignAll?'#E6F4FF':'#fff', borderRadius:8, border:`1.5px solid ${assignAll?'#0072FF':'#DDE4ED'}`}}>
                      <input type="checkbox" checked={assignAll} onChange={e=>setAssignAll(e.target.checked)}/>
                      <span style={{fontSize:13, fontWeight:700, color: assignAll?'#0072FF':'#3B4A5E'}}>All employees</span>
                    </label>
                  </div>
                  {!assignAll && (
                    <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12}}>
                      <PickerGroup label={`Departments (${assignDeptIds.length})`} options={departments.map(d => ({ id: d.id, label: d.name }))} selected={assignDeptIds} onToggle={(id)=>toggle(assignDeptIds, setAssignDeptIds, id)} onSetAll={setAssignDeptIds} searchable/>
                      <PickerGroup label={`Sub-departments (${assignSubDeptIds.length})`} options={filteredSubDepts.map(s => ({ id: s.id, label: s.name }))} selected={assignSubDeptIds} onToggle={(id)=>toggle(assignSubDeptIds, setAssignSubDeptIds, id)} onSetAll={setAssignSubDeptIds} searchable/>
                      <PickerGroup label={`Managers (${assignManagerIds.length})`} options={managerOptions.map(m => ({ id: m.id, label: m.name || m.email }))} selected={assignManagerIds} onToggle={(id)=>toggle(assignManagerIds, setAssignManagerIds, id)} onSetAll={setAssignManagerIds} searchable/>
                      <PickerGroup label={`Designation (${assignDesignationNames.length})`} options={designationOptions.map(d => ({ id: d, label: d }))} selected={assignDesignationNames} onToggle={(id)=>toggle(assignDesignationNames, setAssignDesignationNames, id)} onSetAll={setAssignDesignationNames} searchable/>
                      <PickerGroup label={`Specific employees (${assignEmployeeIds.length})`} options={employeeOptions.map(emp => ({ id: emp.id, label: emp.name || emp.email }))} selected={assignEmployeeIds} onToggle={(id)=>toggle(assignEmployeeIds, setAssignEmployeeIds, id)} onSetAll={setAssignEmployeeIds} searchable/>
                    </div>
                  )}
                  {!assignmentValid && (
                    <div style={{marginTop:10, fontSize:12, color:'#C2261D', fontWeight:600}}>Pick at least one assignment scope.</div>
                  )}
                  {assignmentValid && (
                    <div style={{marginTop:10, padding:'8px 12px', background: previewEmployeeCount > 500 ? '#FFF6E6' : '#E8F7EF', border:`1px solid ${previewEmployeeCount > 500 ? '#FCD79B' : '#C5EBD7'}`, borderRadius:8, fontSize:12, color: previewEmployeeCount > 500 ? '#9A6708' : '#0F7C57', fontWeight:600, display:'flex', alignItems:'center', gap:8}}>
                      <span>{previewEmployeeCount > 500 ? '⚠️' : '✅'}</span>
                      <span>This will assign the course to <strong>{previewEmployeeCount.toLocaleString()}</strong> employee{previewEmployeeCount === 1 ? '' : 's'}.</span>
                      {previewEmployeeCount > 500 && <span style={{marginLeft:'auto', fontSize:11, fontWeight:500}}>Double-check the scope before publishing.</span>}
                    </div>
                  )}
                </div>

                <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:18}}>
                  <Summary label="Course" value={mode==='new' ? courseTitle : (existingCourses.find(c=>c.id===existingCourseId)?.title || '—')}/>
                  <Summary label="Video" value={lessonTitle}/>
                  <Summary label="Duration" value={`${Math.floor(videoDuration/60)}m ${videoDuration%60}s`}/>
                  <Summary label="Quiz questions" value={`${questions.filter(qq=>qq.q.trim()).length}`}/>
                </div>
                {saving && uploadPct > 0 && (
                  <div style={{marginBottom:14}}>
                    <div style={{fontSize:12, color:'#5B6A7D', marginBottom:6}}>Uploading video… {uploadPct}%</div>
                    <div style={{height:6, background:'#EEF2F7', borderRadius:99, overflow:'hidden'}}>
                      <div style={{width:`${uploadPct}%`, height:'100%', background:'linear-gradient(90deg,#00C6FF,#0072FF)', transition:'width .3s'}}/>
                    </div>
                  </div>
                )}
                {error && <div style={{padding:'10px 12px', background:'#FCE1DE', color:'#C2261D', borderRadius:8, fontSize:13, fontWeight:500, marginBottom:14}}>{error}</div>}
                <div style={{display:'flex', gap:10}}>
                  <Btn variant="ghost" onClick={()=>setStep(3)}>← Back</Btn>
                  <Btn variant="success" size="lg" onClick={publish} disabled={saving || !assignmentValid}>{saving ? 'Publishing…' : 'Publish ✓'}</Btn>
                </div>
              </div>
            </Card>
          )}
        </div>

        <div>
          <Card pad={0}>
            <div style={{aspectRatio:'16/9', background:'#0A1F3D', position:'relative', display:'grid', placeItems:'center', borderRadius:'16px 16px 0 0', overflow:'hidden'}}>
              <div style={{position:'absolute', inset:0, background:'radial-gradient(circle at 30% 40%, rgba(0,198,255,.3), transparent 60%), linear-gradient(135deg, #001B30, #0B4A86)'}}/>
              <div style={{position:'relative', color:'#fff', textAlign:'center', padding:16}}>
                <div style={{fontSize:54, marginBottom:8}}>{emoji}</div>
                <div style={{fontSize:14, fontWeight:700}}>{courseTitle || 'Your course preview'}</div>
              </div>
            </div>
            <div style={{padding:16, fontSize:12, color:'#5B6A7D', lineHeight:1.6}}>
              <div style={{fontWeight:700, color:'#0A1F3D', marginBottom:6}}>How publishing works</div>
              • Every employee gets the course automatically<br/>
              • A notification fires to all learners<br/>
              • Watch duration tracked per video<br/>
              • Quiz unlocks at 90% watch
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function PickerGroup({ label, options, selected, onToggle, onSetAll, searchable }: { label: string; options: { id: string; label: string }[]; selected: string[]; onToggle: (id: string) => void; onSetAll: (ids: string[]) => void; searchable?: boolean }) {
  const [q, setQ] = useState('');
  const filtered = q ? options.filter(o => o.label.toLowerCase().includes(q.toLowerCase())) : options;
  const filteredIds = filtered.map(f => f.id);
  const selectedInFiltered = filteredIds.filter(id => selected.includes(id));
  const allFilteredSelected = filteredIds.length > 0 && selectedInFiltered.length === filteredIds.length;
  const toggleSelectAllFiltered = () => {
    if (allFilteredSelected) {
      onSetAll(selected.filter(id => !filteredIds.includes(id)));
      return;
    }
    onSetAll(Array.from(new Set([...selected, ...filteredIds])));
  };
  return (
    <div style={{border:'1px solid #EEF2F7', borderRadius:10, background:'#fff', overflow:'hidden'}}>
      <div style={{padding:'10px 12px', borderBottom:'1px solid #EEF2F7', fontSize:12, fontWeight:700, color:'#3B4A5E', display:'flex', alignItems:'center', gap:8}}>
        <span>{label}</span>
        <button type="button" onClick={toggleSelectAllFiltered} style={{marginLeft:'auto', padding:'4px 8px', border:'1px solid #DDE4ED', borderRadius:6, background:'#fff', cursor:'pointer', fontSize:11, fontWeight:700, color:'#3B4A5E'}}>
          {allFilteredSelected ? 'Clear all' : 'Select all'}
        </button>
        {searchable && (
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search…" style={{padding:'4px 8px', border:'1px solid #DDE4ED', borderRadius:6, fontSize:11, width:120, outline:'none'}}/>
        )}
      </div>
      <div style={{maxHeight:160, overflowY:'auto', padding:'4px 8px'}}>
        {filtered.length === 0 ? (
          <div style={{padding:'10px 4px', fontSize:11, color:'#8A97A8'}}>No options.</div>
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

function Summary({ label, value }: { label:string; value:string }) {
  return (
    <div style={{padding:'12px 14px', background:'#F7F9FC', borderRadius:10, border:'1px solid #EEF2F7'}}>
      <div style={{fontSize:10, fontWeight:700, color:'#8A97A8', letterSpacing:'.08em', textTransform:'uppercase'}}>{label}</div>
      <div style={{fontSize:13, fontWeight:700, color:'#0A1F3D', marginTop:4, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{value || '—'}</div>
    </div>
  );
}
