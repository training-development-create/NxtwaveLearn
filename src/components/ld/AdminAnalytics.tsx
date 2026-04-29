import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Btn, Card, Chip, ProgressBar, Avatar, EmptyState } from "./ui";
import { fmt } from "./data";

type CourseRow = { id: string; title: string };
type LessonRow = { id: string; title: string; course_id: string; duration_seconds: number };
type LearnerRow = {
  id: string; name: string; email: string; empId: string;
  department?: string | null;
  subDepartment?: string | null;
  designation?: string | null;
  managerName?: string | null;
  managerEmail?: string | null;
  managerContact?: string | null;
  watchSec: number; watchPct: number;       // total watched seconds across this course's lessons / total runtime
  completion: number; score: number; attempts: number; status: string;
};
type LessonWatch = { id: string; title: string; avgPct: number; doneCount: number; totalSec: number };
type ManagerRow = { managerEmail: string; managerName: string; total: number; completed: number; pending: number };
type ProfileMini = {
  id: string; full_name: string; email: string; employee_id: string | null;
  department: string | null; sub_department: string | null;
  manager_name: string | null; manager_email: string | null; manager_contact: string | null;
  designation_name: string | null;
};
// Internal helper to convert an employees row (with joined dept + manager)
// into the ProfileMini shape the rest of this file expects.
type EmployeeJoinRow = {
  id: string;
  auth_user_id: string | null;
  email: string;
  name: string;
  employee_id: string | null;
  designation_name: string | null;
  departments: { name: string } | null;
  sub_departments: { name: string } | null;
  manager: { name: string; email: string; contact: string | null } | null;
};
const employeeToProfile = (e: EmployeeJoinRow): ProfileMini | null => {
  if (!e.auth_user_id) return null;
  return {
    id: e.auth_user_id,
    full_name: e.name || e.email,
    email: e.email,
    employee_id: e.employee_id,
    department: e.departments?.name ?? null,
    sub_department: e.sub_departments?.name ?? null,
    manager_name: e.manager?.name ?? null,
    manager_email: e.manager?.email ?? null,
    manager_contact: e.manager?.contact ?? null,
    designation_name: e.designation_name ?? null,
  };
};

export function AdminAnalytics() {
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [lessons, setLessons] = useState<LessonRow[]>([]);
  const [course, setCourse] = useState<string>('');
  const [vid, setVid] = useState<string>('');
  const [kpi, setKpi] = useState({ enrolled: 0, watchPct: 0, completion: 0, passRate: 0, totalWatchSec: 0 });
  // HRMS sync controls
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ ok: boolean; imported?: number; exited?: number; ts: string } | null>(null);
  const triggerSync = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('sync-employees-daily', { body: {} });
      if (error) setSyncResult({ ok: false, ts: new Date().toLocaleTimeString() });
      else setSyncResult({ ok: true, imported: data?.imported ?? 0, exited: data?.exited ?? 0, ts: new Date().toLocaleTimeString() });
      // Reload stats so counts reflect any newly exited employees.
      await loadStats();
    } catch {
      setSyncResult({ ok: false, ts: new Date().toLocaleTimeString() });
    } finally { setSyncing(false); }
  };
  const [lessonWatch, setLessonWatch] = useState<LessonWatch[]>([]);
  const [learners, setLearners] = useState<LearnerRow[]>([]);
  const [retention, setRetention] = useState<{ id: string; title: string; pct: number }[]>([]);
  const [search, setSearch] = useState('');
  const [detailUser, setDetailUser] = useState<LearnerRow | null>(null);
  // Department / manager analytics state.
  const [profilesAll, setProfilesAll] = useState<ProfileMini[]>([]);
  const progArrRef = useRef<{ user_id: string; lesson_id: string; watched_seconds: number; completed: boolean }[]>([]);
  const [department, setDepartment] = useState<string>('all');
  const [subDepartment, setSubDepartment] = useState<string>('all');
  const [managerEmail, setManagerEmail] = useState<string>('all');
  const [designation, setDesignation] = useState<string>('all');
  const [departmentStats, setDepartmentStats] = useState<{ department: string; total: number; completed: number; pct: number }[]>([]);
  const [managerStats, setManagerStats] = useState<ManagerRow[]>([]);

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
  const lessonIds = courseLessons.map(l => l.id);
  const totalRuntime = courseLessons.reduce((s, l) => s + (l.duration_seconds || 0), 0);

  useEffect(() => { if (courseLessons.length) setVid(courseLessons[0].id); else setVid(''); /* eslint-disable-next-line */ }, [course, lessons.length]);

  const loadStats = async () => {
    if (!course) return;

    // Fetch ALL active employees (signed in or not). The previous filter
    // .not('auth_user_id', 'is', null) hid the ~3300 imported employees who
    // haven't signed in yet, so dept/manager rollups undercounted dramatically.
    // We also pull course_assignments + the assigned_employees RPC to scope
    // analytics to "who this course is actually assigned to."
    // Supabase JS caps responses at 1000 rows. With 3000+ employees the
    // analytics rollups silently undercount (and managers' reports look
    // smaller than they are). Page the employees query.
    type EmpAnalytics = EmployeeJoinRow & { id: string };
    const fetchAllEmployees = async (): Promise<EmpAnalytics[]> => {
      const all: EmpAnalytics[] = [];
      const pageSize = 1000;
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
          .from('employees')
          .select('id, auth_user_id, email, name, employee_id, designation_name, departments:department_id(name), sub_departments:sub_department_id(name), manager:manager_id(name, email, contact)')
          .eq('status', 'active')
          .order('name', { ascending: true })
          .range(from, from + pageSize - 1);
        if (error) { console.warn('[AdminAnalytics] employee paging stopped:', error.message); break; }
        if (!data || data.length === 0) break;
        all.push(...(data as unknown as EmpAnalytics[]));
        if (data.length < pageSize) break;
      }
      return all;
    };

    const [{ data: enrolls }, { data: prog }, { data: attempts }, employeesAll, { data: assignedRows }] = await Promise.all([
      supabase.from('enrollments').select('user_id').eq('course_id', course).range(0, 9999),
      lessonIds.length ? supabase.from('lesson_progress').select('user_id, lesson_id, watched_seconds, completed').in('lesson_id', lessonIds).range(0, 99999) : Promise.resolve({ data: [] as { user_id: string; lesson_id: string; watched_seconds: number; completed: boolean }[] }),
      lessonIds.length ? supabase.from('quiz_attempts').select('user_id, lesson_id, score, total, passed').in('lesson_id', lessonIds).range(0, 99999) : Promise.resolve({ data: [] as { user_id: string; lesson_id: string; score: number; total: number; passed: boolean }[] }),
      fetchAllEmployees(),
      supabase.rpc('assigned_employees', { _course_id: course }),
    ]);

    // Build a profile list keyed by employees.id (the org id) AND a separate
    // map keyed by auth_user_id (for joining to lesson_progress / quiz_attempts).
    type RichProfile = ProfileMini & { employee_row_id: string; signed_in: boolean };
    const allProfiles: RichProfile[] = ((employeesAll || []) as unknown as (EmployeeJoinRow & { id: string })[])
      .map(e => {
        const base = employeeToProfile(e);
        return {
          id: e.auth_user_id ?? e.id,
          employee_row_id: e.id,
          signed_in: !!e.auth_user_id,
          full_name: base?.full_name ?? (e.name || e.email),
          email: e.email,
          employee_id: e.employee_id,
          department: e.departments?.name ?? null,
          sub_department: e.sub_departments?.name ?? null,
          manager_name: e.manager?.name ?? null,
          manager_email: e.manager?.email ?? null,
          manager_contact: e.manager?.contact ?? null,
          designation_name: e.designation_name ?? null,
        };
      });

    // Set of employees this course is assigned to (org-id, not auth-id).
    // assigned_employees() returns rows like { employee_id: <employees.id> }.
    const assignedEmployeeRowIds = new Set(((assignedRows || []) as { employee_id: string }[]).map(r => r.employee_id));
    // Profiles in the assignment scope (whether signed in or not).
    // When the course has no assignment rows OR is assigned via scope_all=true
    // (which means assignedRows returns ALL active employees), this naturally
    // contains everyone — matching the "Show all departments" choice for
    // scope_all courses.
    const assignedProfiles = assignedEmployeeRowIds.size
      ? allProfiles.filter(p => assignedEmployeeRowIds.has(p.employee_row_id))
      : allProfiles;

    const enrolledIds = new Set((enrolls || []).map((e: { user_id: string }) => e.user_id));
    // IMPORTANT: profilesAll powers the cascading dept / sub-dept / manager
    // dropdowns AND the per-video table. Scoping it to assignedProfiles means
    // the filters only show departments / sub-depts / managers the SELECTED
    // course is actually assigned to.
    setProfilesAll(assignedProfiles);
    const profilesTyped: ProfileMini[] = assignedProfiles;
    const progArr = (prog || []) as { user_id: string; lesson_id: string; watched_seconds: number; completed: boolean }[];
    progArrRef.current = progArr;
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

    const profById = new Map(profilesTyped.map(p => [p.id, p]));
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
        department: u.department, subDepartment: u.sub_department, designation: u.designation_name,
        managerName: u.manager_name, managerEmail: u.manager_email, managerContact: u.manager_contact,
        watchSec, watchPct, completion, score, attempts: userAtt.length, status,
      };
    }).filter(Boolean) as LearnerRow[];
    rows.sort((a, b) => b.watchSec - a.watchSec);
    setLearners(rows);
  };

  useEffect(() => {
    loadStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course, lessons]);

  // Reactive Stats Rollups (Aggregated from allProfiles + filter state)
  const stats = useMemo(() => {
    const isCourseComplete = (authId: string) =>
      lessonIds.length > 0 && lessonIds.every(lid => progArrRef.current.some(p => p.user_id === authId && p.lesson_id === lid && p.completed));

    const dMap = new Map<string, { total: number; completed: number }>();
    const mMap = new Map<string, { managerEmail: string; managerName: string; total: number; completed: number }>();

    profilesAll.forEach(p => {
      // Narrow stats by ALL OTHER active filters (Cascading Narrowing)
      if (department !== 'all' && (p.department || 'Unassigned') !== department) return;
      if (subDepartment !== 'all' && (p.sub_department || 'Unassigned') !== subDepartment) return;
      if (designation !== 'all' && (p.designation_name || 'Unassigned') !== designation) return;
      // Note: we don't narrow by managerEmail here because the manager table IS the manager breakdown

      const d = p.department || 'Unassigned';
      const curD = dMap.get(d) || { total: 0, completed: 0 };
      curD.total++;
      if (p.signed_in && isCourseComplete(p.id)) curD.completed++;
      dMap.set(d, curD);

      const mKey = p.manager_email || p.manager_name || 'Unassigned';
      const curM = mMap.get(mKey) || { managerEmail: p.manager_email || '', managerName: p.manager_name || 'Unassigned', total: 0, completed: 0 };
      curM.total++;
      if (p.signed_in && isCourseComplete(p.id)) curM.completed++;
      mMap.set(mKey, curM);
    });

    const dStats = Array.from(dMap.entries())
      .map(([dept, v]) => ({ department: dept, total: v.total, completed: v.completed, pct: v.total ? Math.round((v.completed / v.total) * 100) : 0 }))
      .sort((a, b) => b.total - a.total);

    const mStats = Array.from(mMap.values())
      .map(m => ({ ...m, pending: m.total - m.completed }))
      .sort((a, b) => b.pending - a.pending);

    return { dStats, mStats };
  }, [profilesAll, department, subDepartment, designation, lessonIds]);

  const departmentStats = stats.dStats;
  const managerStats = stats.mStats;

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

  const filtered = learners.filter(l => {
    if (department !== 'all' && (l.department || 'Unassigned') !== department) return false;
    if (subDepartment !== 'all' && (l.subDepartment || 'Unassigned') !== subDepartment) return false;
    if (managerEmail !== 'all') {
      const key = l.managerEmail || l.managerName || 'Unassigned';
      if (key !== managerEmail) return false;
    }
    if (designation !== 'all' && (l.designation || 'Unassigned') !== designation) return false;
    if (search && !`${l.name} ${l.empId} ${l.email}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // Mutually Narrowing Filter Options
  const departmentOptions = Array.from(new Set(
    profilesAll
      .filter(p => (subDepartment === 'all' || (p.sub_department || 'Unassigned') === subDepartment))
      .filter(p => (managerEmail === 'all' || (p.manager_email || p.manager_name || 'Unassigned') === managerEmail))
      .filter(p => (designation === 'all' || (p.designation_name || 'Unassigned') === designation))
      .map(p => p.department || 'Unassigned')
  )).sort();

  const subDepartmentOptions = Array.from(new Set(
    profilesAll
      .filter(p => (department === 'all' || (p.department || 'Unassigned') === department))
      .filter(p => (managerEmail === 'all' || (p.manager_email || p.manager_name || 'Unassigned') === managerEmail))
      .filter(p => (designation === 'all' || (p.designation_name || 'Unassigned') === designation))
      .map(p => p.sub_department || 'Unassigned'),
  )).sort();

  const managerOptions = Array.from(new Map(
    profilesAll
      .filter(p => (department === 'all' || (p.department || 'Unassigned') === department))
      .filter(p => (subDepartment === 'all' || (p.sub_department || 'Unassigned') === subDepartment))
      .filter(p => (designation === 'all' || (p.designation_name || 'Unassigned') === designation))
      .map(p => {
        const key = p.manager_email || p.manager_name || 'Unassigned';
        return [key, { key, label: p.manager_name || p.manager_email || 'Unassigned' }];
      }),
  ).values()).sort((a, b) => a.label.localeCompare(b.label));

  const designationOptions = Array.from(new Set(
    profilesAll
      .filter(p => (department === 'all' || (p.department || 'Unassigned') === department))
      .filter(p => (subDepartment === 'all' || (p.sub_department || 'Unassigned') === subDepartment))
      .filter(p => (managerEmail === 'all' || (p.manager_email || p.manager_name || 'Unassigned') === managerEmail))
      .map(p => p.designation_name || 'Unassigned')
  )).sort();

  useEffect(() => {
    if (managerEmail === 'all') return;
    const allowed = new Set(managerOptions.map(m => m.key));
    if (!allowed.has(managerEmail)) setManagerEmail('all');
  }, [department, subDepartment, managerOptions, managerEmail]);
  useEffect(() => {
    if (designation === 'all') return;
    if (!designationOptions.includes(designation)) setDesignation('all');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [department, subDepartment, managerEmail]);

  if (courses.length === 0) {
    return <div style={{padding:36}}><EmptyState icon="📊" title="No courses to analyze" sub="Once you publish a course in Upload & Quiz, analytics will start tracking it."/></div>;
  }

  // Per-video drill-down
  const selectedLesson = courseLessons.find(l => l.id === vid);

  return (
    <div style={{padding:'28px 36px 48px', animation:'fadeUp .3s'}}>
      {/* HRMS Sync banner */}
      <div style={{display:'flex', alignItems:'center', gap:12, marginBottom:16, padding:'10px 16px', background:'#F7F9FC', border:'1px solid #EEF2F7', borderRadius:10}}>
        <span style={{fontSize:13, fontWeight:700, color:'#0A1F3D'}}>🔄 HRMS Sync</span>
        <span style={{fontSize:12, color:'#5B6A7D', flex:1}}>Keep employee data current with Darwinbox. Exited employees are removed automatically every hour.</span>
        {syncResult && (
          <span style={{fontSize:11, color: syncResult.ok ? '#17A674' : '#C2261D', fontWeight:600}}>
            {syncResult.ok ? `✓ ${syncResult.imported} imported · ${syncResult.exited} exited · ${syncResult.ts}` : `✗ Sync failed · ${syncResult.ts}`}
          </span>
        )}
        <button
          onClick={triggerSync}
          disabled={syncing}
          style={{padding:'7px 16px', background: syncing ? '#EEF2F7' : '#0072FF', color: syncing ? '#8A97A8' : '#fff', border:'none', borderRadius:8, fontSize:12, fontWeight:700, cursor: syncing ? 'not-allowed' : 'pointer', transition:'background .15s'}}
        >
          {syncing ? 'Syncing…' : 'Sync Now'}
        </button>
      </div>
      <div style={{display:'flex', gap:10, marginBottom:20, alignItems:'center', flexWrap:'wrap'}}>
        <select value={course} onChange={e=>setCourse(e.target.value)} style={{padding:'10px 14px', border:'1px solid #DDE4ED', borderRadius:10, fontSize:13, background:'#fff', minWidth:280, fontWeight:600}}>
          {courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
        {courseLessons.length > 0 && (
          <select value={vid} onChange={e=>setVid(e.target.value)} style={{padding:'10px 14px', border:'1px solid #DDE4ED', borderRadius:10, fontSize:13, background:'#fff', minWidth:300, fontWeight:600}}>
            {courseLessons.map(l => <option key={l.id} value={l.id}>{l.title}</option>)}
          </select>
        )}
        <select value={department} onChange={e=>setDepartment(e.target.value)} title="Filter by department" style={{padding:'10px 14px', border:'1px solid #DDE4ED', borderRadius:10, fontSize:13, background:'#fff', minWidth:200, fontWeight:600}}>
          <option value="all">All departments</option>
          {departmentOptions.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select value={subDepartment} onChange={e=>setSubDepartment(e.target.value)} title="Filter by sub-department" style={{padding:'10px 14px', border:'1px solid #DDE4ED', borderRadius:10, fontSize:13, background:'#fff', minWidth:220, fontWeight:600}}>
          <option value="all">All sub-departments</option>
          {subDepartmentOptions.map(sd => <option key={sd} value={sd}>{sd}</option>)}
        </select>
        <select value={managerEmail} onChange={e=>setManagerEmail(e.target.value)} title="Filter by manager" style={{padding:'10px 14px', border:'1px solid #DDE4ED', borderRadius:10, fontSize:13, background:'#fff', minWidth:220, fontWeight:600}}>
          <option value="all">All managers</option>
          {managerOptions.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
        <select value={designation} onChange={e=>setDesignation(e.target.value)} title="Filter by designation" style={{padding:'10px 14px', border:'1px solid #DDE4ED', borderRadius:10, fontSize:13, background:'#fff', minWidth:200, fontWeight:600}}>
          <option value="all">All designations</option>
          {designationOptions.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      {/* Department completion + Manager leaderboard */}
      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:20}}>
        <Card pad={0}>
          <div style={{padding:'14px 18px', borderBottom:'1px solid #EEF2F7'}}>
            <div className="eyebrow">DEPARTMENT COMPLETION (THIS COURSE)</div>
          </div>
          <div style={{maxHeight:260, overflowY:'auto'}}>
            {departmentStats.length === 0 ? (
              <div style={{padding:20, color:'#8A97A8', fontSize:12}}>No enrollments yet.</div>
            ) : (
              <table style={{width:'100%', borderCollapse:'collapse'}}>
                <thead><tr style={{background:'#FAFBFE'}}>
                  {['Department','Total','Completed','%'].map(h => (
                    <th key={h} style={{padding:'9px 14px', textAlign:'left', fontSize:10, color:'#8A97A8', fontWeight:700, letterSpacing:'.08em', borderBottom:'1px solid #EEF2F7'}}>{h.toUpperCase()}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {departmentStats.map(d => (
                    <tr key={d.department} onClick={()=>setDepartment(d.department)} style={{borderBottom:'1px solid #F7F9FC', cursor:'pointer', background: department===d.department ? '#F2F9FF' : undefined}}>
                      <td style={{padding:'9px 14px', fontSize:13, fontWeight:600, color:'#002A4B'}}>{d.department}</td>
                      <td style={{padding:'9px 14px', fontSize:13, color:'#3B4A5E'}}>{d.total}</td>
                      <td style={{padding:'9px 14px', fontSize:13, color:'#17A674', fontWeight:700}}>{d.completed}</td>
                      <td style={{padding:'9px 14px', minWidth:140}}><ProgressBar value={d.pct} showLabel height={4}/></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>

        <Card pad={0}>
          <div style={{padding:'14px 18px', borderBottom:'1px solid #EEF2F7'}}>
            <div className="eyebrow">MANAGER LEADERBOARD — RISK (HIGHEST PENDING FIRST)</div>
          </div>
          <div style={{maxHeight:260, overflowY:'auto'}}>
            {managerStats.length === 0 ? (
              <div style={{padding:20, color:'#8A97A8', fontSize:12}}>No managers yet — Darwin sync hasn't populated profiles.</div>
            ) : (
              <table style={{width:'100%', borderCollapse:'collapse'}}>
                <thead><tr style={{background:'#FAFBFE'}}>
                  {['Manager','Total','Completed','Pending'].map(h => (
                    <th key={h} style={{padding:'9px 14px', textAlign:'left', fontSize:10, color:'#8A97A8', fontWeight:700, letterSpacing:'.08em', borderBottom:'1px solid #EEF2F7'}}>{h.toUpperCase()}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {managerStats.map(m => {
                    const key = m.managerEmail || m.managerName || 'Unassigned';
                    return (
                      <tr key={key} onClick={()=>setManagerEmail(key)} style={{borderBottom:'1px solid #F7F9FC', cursor:'pointer', background: managerEmail===key ? '#F2F9FF' : undefined}}>
                        <td style={{padding:'9px 14px', fontSize:13, fontWeight:600, color:'#002A4B'}}>
                          {m.managerName || '—'}
                          {m.managerEmail && <div style={{fontSize:11, color:'#5B6A7D', fontWeight:500}}>{m.managerEmail}</div>}
                        </td>
                        <td style={{padding:'9px 14px', fontSize:13, color:'#3B4A5E', fontWeight:700}}>{m.total}</td>
                        <td style={{padding:'9px 14px', fontSize:13, color:'#17A674', fontWeight:700}}>{m.completed}</td>
                        <td style={{padding:'9px 14px', fontSize:13, color: m.pending > 0 ? '#C2261D' : '#8A97A8', fontWeight:800}}>{m.pending}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      </div>

      {/* Manager team breakdown — only when a manager is picked */}
      {managerEmail !== 'all' && (() => {
        const learnerByAuthId = new Map(learners.map(l => [l.id, l]));
        // All employees under this manager (signed in or not), from profilesAll.
        const teamRows = profilesAll
          .filter(p => (p.manager_email || p.manager_name || 'Unassigned') === managerEmail)
          .map(p => {
            const lr = learnerByAuthId.get(p.id);
            return {
              id: p.id,
              name: p.full_name || p.email,
              email: p.email,
              empId: p.employee_id || '—',
              department: p.department,
              subDepartment: p.sub_department,
              completion: lr?.completion ?? 0,
              watchPct: lr?.watchPct ?? 0,
              score: lr?.score ?? 0,
              attempts: lr?.attempts ?? 0,
              signedIn: !!lr,
              status: lr ? (lr.completion === 100 ? 'completed' : lr.completion > 0 ? 'in-progress' : 'not-started')
                         : 'not-signed-in',
            };
          })
          .sort((a, b) => b.completion - a.completion || a.name.localeCompare(b.name));
        const completed = teamRows.filter(r => r.status === 'completed').length;
        const inProgress = teamRows.filter(r => r.status === 'in-progress').length;
        const notStarted = teamRows.filter(r => r.status === 'not-started').length;
        const notSignedIn = teamRows.filter(r => r.status === 'not-signed-in').length;
        const managerLabel = managerOptions.find(m => m.key === managerEmail)?.label || managerEmail;

        return (
          <Card pad={0} style={{marginBottom:20}}>
            <div style={{padding:'14px 18px', display:'flex', alignItems:'center', gap:14, borderBottom:'1px solid #EEF2F7'}}>
              <div>
                <div className="eyebrow">MANAGER TEAM BREAKDOWN</div>
                <div style={{fontSize:14, fontWeight:800, color:'#0A1F3D', marginTop:2}}>{managerLabel}'s team — {teamRows.length} employee{teamRows.length === 1 ? '' : 's'}</div>
              </div>
              <div style={{marginLeft:'auto', display:'flex', gap:8, flexWrap:'wrap'}}>
                <Chip color="#17A674">{completed} completed</Chip>
                <Chip color="#E08A1E">{inProgress} in progress</Chip>
                <Chip color="#C2261D">{notStarted} not started</Chip>
                {notSignedIn > 0 && <Chip color="#8A97A8">{notSignedIn} pending login</Chip>}
                <button onClick={()=>setManagerEmail('all')} style={{padding:'6px 12px', background:'#F7F9FC', border:'1px solid #DDE4ED', borderRadius:6, fontSize:11, fontWeight:600, color:'#3B4A5E', cursor:'pointer'}}>Clear ✕</button>
              </div>
            </div>
            <div style={{maxHeight:380, overflowY:'auto'}}>
              {teamRows.length === 0 ? (
                <div style={{padding:24, fontSize:13, color:'#8A97A8'}}>No reports found for this manager in the assigned scope.</div>
              ) : (
                <table style={{width:'100%', borderCollapse:'collapse'}}>
                  <thead>
                    <tr style={{background:'#FAFBFE'}}>
                      {['Employee', 'Sub-dept', 'Completion', 'Quiz %', 'Status'].map(h => (
                        <th key={h} style={{padding:'10px 16px', textAlign:'left', fontSize:10, color:'#8A97A8', fontWeight:700, letterSpacing:'.08em', borderBottom:'1px solid #EEF2F7'}}>{h.toUpperCase()}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {teamRows.map(r => (
                      <tr
                        key={r.id}
                        onClick={r.signedIn ? () => setDetailUser(learnerByAuthId.get(r.id) as LearnerRow) : undefined}
                        style={{borderBottom:'1px solid #F7F9FC', cursor: r.signedIn ? 'pointer' : 'default', opacity: r.status === 'not-signed-in' ? 0.65 : 1}}
                      >
                        <td style={{padding:'10px 16px'}}>
                          <div style={{display:'flex', alignItems:'center', gap:10}}>
                            <Avatar name={r.name} size={26}/>
                            <div>
                              <div style={{fontSize:13, fontWeight:600, color:'#002A4B'}}>{r.name}</div>
                              <div style={{fontSize:11, color:'#5B6A7D'}}>{r.email} · <code style={{fontSize:10, background:'#F2F9FF', padding:'1px 5px', borderRadius:3, color:'#0072FF', fontWeight:700}}>{r.empId}</code></div>
                            </div>
                          </div>
                        </td>
                        <td style={{padding:'10px 16px', fontSize:12, color:'#5B6A7D'}}>{r.subDepartment || '—'}</td>
                        <td style={{padding:'10px 16px', minWidth:160}}><ProgressBar value={r.completion} showLabel/></td>
                        <td style={{padding:'10px 16px', fontSize:12, fontWeight:800, color: r.score >= 70 ? '#17A674' : r.score > 0 ? '#C2261D' : '#8A97A8'}}>{r.score > 0 ? `${r.score}%` : '—'}</td>
                        <td style={{padding:'10px 16px'}}>
                          <Chip color={r.status === 'completed' ? '#17A674' : r.status === 'in-progress' ? '#E08A1E' : r.status === 'not-started' ? '#C2261D' : '#8A97A8'}>
                            {r.status === 'completed' ? 'Completed' : r.status === 'in-progress' ? 'In progress' : r.status === 'not-started' ? 'Not started' : 'Pending login'}
                          </Chip>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </Card>
        );
      })()}

      <Card pad={0}>
        <div style={{padding:'18px 22px', display:'flex', alignItems:'center', borderBottom:'1px solid #EEF2F7'}}>
          <div>
            <div className="eyebrow">PER-LEARNER WATCH (CLICK TO OPEN PROFILE)</div>
            <div style={{fontSize:16, fontWeight:800, color:'#002A4B', marginTop:2}}>
              {selectedLesson ? `${selectedLesson.title} · runtime ${fmt(selectedLesson.duration_seconds)}` : 'Select a video'}
            </div>
          </div>
          {selectedLesson && (
            <div style={{marginLeft:'auto'}}>
              <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search learner…" style={{padding:'8px 12px', border:'1px solid #DDE4ED', borderRadius:8, fontSize:12, minWidth:220}}/>
            </div>
          )}
        </div>
        {selectedLesson ? (
          <PerLessonWatch
            lessonId={selectedLesson.id}
            runtime={selectedLesson.duration_seconds}
            courseId={course}
            search={search}
            allowedUserIds={(department !== 'all' || subDepartment !== 'all' || managerEmail !== 'all') ? new Set(filtered.map(f => f.id)) : null}
            onOpenUser={(u)=>setDetailUser(u)}
          />
        ) : (
          <div style={{padding:24}}><EmptyState icon="🎬" title="Select a video" sub="Choose a course and video to see watch progress and assessments."/></div>
        )}
      </Card>

      {detailUser && <EmployeeDetailModal user={detailUser} onClose={()=>setDetailUser(null)} focusCourseId={course}/>}
    </div>
  );
}

function EmployeeDetailModal({ user, onClose, focusCourseId }: { user: LearnerRow; onClose: () => void; focusCourseId: string }) {
  type CourseDetail = {
    id: string; title: string; emoji: string; enrolled: boolean;
    totalRuntime: number; totalWatched: number; lessonsTotal: number; lessonsCompleted: number;
    avgScore: number; status: 'completed' | 'in-progress' | 'not-started';
    lessons: { id: string; title: string; runtime: number; watched: number; pct: number; completed: boolean; bestScore: number; attempts: number }[];
  };
  const [details, setDetails] = useState<CourseDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastLoginAt, setLastLoginAt] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [{ data: courses }, { data: lessons }, { data: enrolls }, { data: progress }, { data: attempts }, { data: prof }] = await Promise.all([
        supabase.from('courses').select('id, title, emoji').order('created_at', { ascending: true }),
        supabase.from('lessons').select('id, course_id, title, duration_seconds, position').order('position', { ascending: true }),
        supabase.from('enrollments').select('course_id').eq('user_id', user.id),
        supabase.from('lesson_progress').select('lesson_id, watched_seconds, completed').eq('user_id', user.id),
        supabase.from('quiz_attempts').select('lesson_id, score, total, passed').eq('user_id', user.id),
        supabase.from('employees').select('last_login_at').eq('auth_user_id', user.id).maybeSingle(),
      ]);
      setLastLoginAt((prof as any)?.last_login_at ?? null);
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
            completed: !!p?.completed, bestScore, attempts: atts.length,
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
      // Show all course activity for the user (remove focusCourseId filter)
      setDetails(out);
      setLoading(false);
    })();
  }, [user.id, focusCourseId]);

  const d = details[0];
  const courseCompletionPct = d?.lessonsTotal ? Math.round((d.lessonsCompleted / d.lessonsTotal) * 100) : 0;
  const watchPct = d?.totalRuntime ? Math.min(100, Math.round((d.totalWatched / d.totalRuntime) * 100)) : 0;
  const assessmentsCompleted = d?.lessons.filter(l => l.bestScore > 0 && l.completed).length ?? 0;
  const assessmentsTotal = d?.lessons.length ?? 0;

  return (
    <div onClick={onClose} style={{position:'fixed', inset:0, background:'rgba(10,31,61,.55)', zIndex:1000, display:'grid', placeItems:'center', padding:24, animation:'fadeUp .2s'}}>
      <div onClick={e=>e.stopPropagation()} style={{background:'#fff', borderRadius:14, maxWidth:920, width:'100%', maxHeight:'90vh', display:'flex', flexDirection:'column', overflow:'hidden'}}>
        <div style={{padding:'20px 24px', borderBottom:'1px solid #EEF2F7', display:'flex', alignItems:'center', gap:14}}>
          <Avatar name={user.name} size={42}/>
          <div style={{flex:1, minWidth:0}}>
            <div style={{fontSize:16, fontWeight:800, color:'#002A4B'}}>{user.name}</div>
            <div style={{fontSize:12, color:'#5B6A7D'}}>{user.email} · <code style={{background:'#F7F9FC', padding:'2px 6px', borderRadius:4, color:'#0072FF', fontWeight:700}}>{user.empId}</code></div>
            {(user.department || user.subDepartment || user.managerName) && (
              <div style={{marginTop:6, display:'flex', flexWrap:'wrap', gap:8, fontSize:11, color:'#3B4A5E'}}>
                {user.department && <span style={{padding:'3px 8px', background:'#F2F9FF', border:'1px solid #CCEAFF', borderRadius:6, fontWeight:600}}>Dept: {user.department}</span>}
                {user.subDepartment && <span style={{padding:'3px 8px', background:'#F6F8FC', border:'1px solid #E6ECF5', borderRadius:6, fontWeight:600}}>Sub-dept: {user.subDepartment}</span>}
                {user.managerName && <span style={{padding:'3px 8px', background:'#FAFBFD', border:'1px solid #EEF2F7', borderRadius:6, fontWeight:600}}>Manager: {user.managerName}{user.managerContact ? ` · ${user.managerContact}` : ''}</span>}
                {user.managerEmail && <span style={{padding:'3px 8px', background:'#FAFBFD', border:'1px solid #EEF2F7', borderRadius:6, fontWeight:500, color:'#5B6A7D'}}>{user.managerEmail}</span>}
              </div>
            )}
            {lastLoginAt && (
              <div style={{marginTop:8}}>
                <span style={{display:'inline-flex', alignItems:'center', gap:8, padding:'6px 10px', borderRadius:999, background:'#F7F9FC', border:'1px solid #EEF2F7'}}>
                  <span style={{fontSize:11, fontWeight:800, color:'#5B6A7D', letterSpacing:'.06em', textTransform:'uppercase'}}>Last login</span>
                  <span style={{width:1, height:14, background:'#DDE4ED'}}/>
                  <span style={{fontSize:12, fontWeight:800, color:'#002A4B'}}>{new Date(lastLoginAt).toLocaleString()}</span>
                </span>
              </div>
            )}
          </div>
          <button onClick={onClose} style={{padding:'6px 14px', background:'#F7F9FC', border:'1px solid #DDE4ED', borderRadius:8, fontSize:13, fontWeight:600, color:'#3B4A5E', cursor:'pointer'}}>Close</button>
        </div>

        <div style={{padding:'16px 24px', display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, borderBottom:'1px solid #EEF2F7', background:'#FAFBFD'}}>
          <MiniStat label="Course completion" v={`${courseCompletionPct}%`}/>
          <MiniStat label="Video watch progress" v={`${watchPct}%`}/>
          <MiniStat label="Assessment completion" v={`${assessmentsCompleted}/${assessmentsTotal}`}/>
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
                      {['Video','Watched','Of runtime','Quiz %','Attempts','Status'].map(h => (
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
                        <td style={{padding:'8px 14px', fontSize:12, color:'#5B6A7D', fontWeight:700}}>{l.attempts || 0}</td>
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

function PerLessonWatch({ lessonId, runtime, courseId, search, allowedUserIds, onOpenUser }: { lessonId: string; runtime: number; courseId: string; search: string; allowedUserIds: Set<string> | null; onOpenUser?: (u: LearnerRow) => void }) {
  const [rows, setRows] = useState<{ id: string; name: string; email: string; empId: string; department?: string | null; managerName?: string | null; managerEmail?: string | null; managerContact?: string | null; sec: number; pct: number; completed: boolean; quizPct: number; attempts: number }[]>([]);
  const chNameRef = useRef<string>('');
  const load = async () => {
    const [{ data: enrolls }, { data: progress }, { data: profiles }, { data: attempts }] = await Promise.all([
      supabase.from('enrollments').select('user_id').eq('course_id', courseId),
      supabase.from('lesson_progress').select('user_id, watched_seconds, completed').eq('lesson_id', lessonId),
      supabase.from('employees')
        .select('id, auth_user_id, email, name, employee_id, departments:department_id(name), sub_departments:sub_department_id(name), manager:manager_id(name, email, contact)')
        .not('auth_user_id', 'is', null)
        .eq('status', 'active'),  // exited employees must not appear in per-video table
      supabase.from('quiz_attempts').select('user_id, score, total').eq('lesson_id', lessonId),
    ]);
    const enrolledIds = new Set((enrolls || []).map((e: { user_id: string }) => e.user_id));
    const profById = new Map(
      ((profiles || []) as unknown as EmployeeJoinRow[])
        .map(employeeToProfile)
        .filter((p): p is ProfileMini => p !== null)
        .map(p => [p.id, p])
    );
    const progByUser = new Map(((progress || []) as { user_id: string; watched_seconds: number; completed: boolean }[]).map(p => [p.user_id, p]));
    const attsByUser = new Map<string, { score: number; total: number }[]>();
    ((attempts || []) as { user_id: string; score: number; total: number }[]).forEach(a => {
      const arr = attsByUser.get(a.user_id) || [];
      arr.push(a);
      attsByUser.set(a.user_id, arr);
    });
    const out = Array.from(enrolledIds)
      .filter(uid => !allowedUserIds || allowedUserIds.has(uid))
      .map(uid => {
        const u = profById.get(uid);
        const p = progByUser.get(uid);
        const sec = p?.watched_seconds || 0;
        const atts = attsByUser.get(uid) || [];
        const quizPct = atts.length ? atts.reduce((m, a) => Math.max(m, a.total ? Math.round((a.score/a.total)*100) : 0), 0) : 0;
        return {
          id: uid, name: u?.full_name || u?.email || '—', email: u?.email || '', empId: u?.employee_id || '—',
          department: u?.department, subDepartment: u?.sub_department, managerName: u?.manager_name, managerEmail: u?.manager_email, managerContact: u?.manager_contact,
          sec, pct: runtime ? Math.min(100, Math.round((sec / runtime) * 100)) : 0,
          completed: !!p?.completed,
          quizPct,
          attempts: atts.length,
        };
      });
    out.sort((a, b) => b.sec - a.sec);
    const q = (search || '').toLowerCase().trim();
    setRows(!q ? out : out.filter(r => `${r.name} ${r.email} ${r.empId}`.toLowerCase().includes(q)));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [lessonId, runtime, courseId, allowedUserIds]);
  useEffect(() => {
    // Use a unique channel name per mount to avoid StrictMode double-mount races
    // that can reuse a previously-subscribed channel instance.
    chNameRef.current = `per-lesson-${lessonId}-${Math.random().toString(36).slice(2)}`;
    const ch = supabase
      .channel(chNameRef.current)
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
            {['Employee','Emp ID','Watched','Of runtime','Quiz %','Attempts','Status'].map(h => (
              <th key={h} style={{padding:'10px 16px', textAlign:'left', fontSize:10, color:'#8A97A8', fontWeight:700, letterSpacing:'.08em', borderBottom:'1px solid #EEF2F7'}}>{h.toUpperCase()}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr
              key={r.id}
              onClick={() => onOpenUser?.({ id: r.id, name: r.name, email: r.email, empId: r.empId, department: r.department, subDepartment: r.subDepartment, managerName: r.managerName, managerEmail: r.managerEmail, managerContact: r.managerContact, watchSec: r.sec, watchPct: r.pct, completion: r.completed ? 100 : 0, score: r.quizPct, attempts: r.attempts, status: r.completed ? 'active' : (r.sec > 0 ? 'at-risk' : 'inactive') })}
              style={{borderBottom:'1px solid #F7F9FC', cursor: onOpenUser ? 'pointer' : 'default'}}
            >
              <td style={{padding:'10px 16px'}}>
                <div style={{display:'flex', alignItems:'center', gap:10}}>
                  <Avatar name={r.name} size={26}/>
                  <div>
                    <div style={{fontSize:13, fontWeight:600, color:'#002A4B'}}>{r.name}</div>
                    <div style={{fontSize:11, color:'#5B6A7D'}}>{r.email}</div>
                  </div>
                </div>
              </td>
              <td style={{padding:'10px 16px'}}><code style={{fontSize:12, background:'#F7F9FC', padding:'3px 8px', borderRadius:6, color:'#0072FF', fontWeight:700}}>{r.empId}</code></td>
              <td style={{padding:'10px 16px', fontSize:13, fontWeight:700, color:'#002A4B'}}>{fmt(r.sec)}</td>
              <td style={{padding:'10px 16px', minWidth:200}}><ProgressBar value={r.pct} showLabel/></td>
              <td style={{padding:'10px 16px', fontSize:12, fontWeight:800, color: r.quizPct>=70?'#17A674':r.quizPct>0?'#C2261D':'#8A97A8'}}>{r.quizPct>0?`${r.quizPct}%`:'—'}</td>
              <td style={{padding:'10px 16px', fontSize:12, fontWeight:800, color:'#3B4A5E'}}>{r.attempts}</td>
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
