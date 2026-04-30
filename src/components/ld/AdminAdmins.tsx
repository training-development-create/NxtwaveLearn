// Admins page: promote/demote admin users + soft-disable employees.
// Sourced from public.employees (the org-aware table). is_admin is a column
// on employees; promoting flips this flag and on the user's next page load
// auth.tsx's loadProfileAndRole picks it up and grants full admin role.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Btn, Card, Chip, EmptyState, Avatar } from "./ui";

type Row = {
  id: string;                       // employees.id
  email: string;
  full_name: string;
  employeeCode: string | null;      // HR employee code (NW0001 etc.)
  isAdmin: boolean;
  status: 'active' | 'inactive' | 'unassigned';
  department: string | null;
  managerName: string | null;
  hasLoggedIn: boolean;             // true once auth_user_id is set on employees
  lastLoginAt: string | null;
};

export function AdminAdmins() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState<'all' | 'admins' | 'learners' | 'inactive'>('all');
  // Promotion-feedback toast — keeps the admin oriented after a Make/Revoke action.
  const [flash, setFlash] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    // Page through employees to bypass Supabase 1000-row default — same fix
    // we did elsewhere. Without this, search wouldn't find anyone outside
    // the first page on orgs with >1000 employees.
    type EmpRow = { id: string; email: string; name: string; employee_id: string | null; is_admin: boolean; status: Row['status']; auth_user_id: string | null; last_login_at: string | null; departments: { name: string } | null; manager: { name: string } | null };
    const all: EmpRow[] = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase
        .from('employees')
        .select(`id, email, name, employee_id, is_admin, status, auth_user_id, last_login_at, departments:department_id ( name ), manager:manager_id ( name )`)
        .order('name', { ascending: true })
        .range(from, from + pageSize - 1);
      if (error) { setErr(error.message); setLoading(false); return; }
      if (!data || data.length === 0) break;
      all.push(...(data as unknown as EmpRow[]));
      if (data.length < pageSize) break;
    }
    setRows(all.map(r => ({
      id: r.id,
      email: r.email,
      full_name: r.name || r.email,
      employeeCode: r.employee_id,
      isAdmin: r.is_admin,
      status: r.status,
      department: r.departments?.name ?? null,
      managerName: r.manager?.name ?? null,
      hasLoggedIn: !!r.auth_user_id,
      lastLoginAt: r.last_login_at,
    })));
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  // Live refresh: respond to Sync Now broadcast (instant) AND to any
  // employees-table changes (debounced 800ms). Without this, freshly
  // imported employees, exits, and promotions wouldn't appear here until
  // the admin reloads the page.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const debouncedReload = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { load(); }, 800);
    };
    const onSynced = () => { load(); };
    window.addEventListener('employees-synced', onSynced);
    const ch = supabase
      .channel(`admin-admins-org-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'employees' }, debouncedReload)
      .subscribe();
    return () => {
      window.removeEventListener('employees-synced', onSynced);
      if (timer) clearTimeout(timer);
      supabase.removeChannel(ch);
    };
    // load is stable enough — re-running this effect on every render would
    // tear down + recreate the realtime channel, which is wasteful.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-clear flash toast after a few seconds.
  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), 4500);
    return () => clearTimeout(id);
  }, [flash]);

  const toggleAdmin = async (r: Row) => {
    setBusy(r.id); setErr(null);
    const { error } = await supabase.from('employees').update({ is_admin: !r.isAdmin }).eq('id', r.id);
    if (error) {
      setErr(error.message);
    } else {
      // Confirmation toast — the new admin gets full access on their next
      // page load (auth.tsx reloads role from employees.is_admin on login
      // and on session refresh).
      setFlash(
        r.isAdmin
          ? `${r.full_name || r.email} is no longer an admin.`
          : `${r.full_name || r.email} is now an admin. They get full admin access on their next sign-in or page refresh.`,
      );
    }
    setBusy(null);
    load();
  };

  const toggleActive = async (r: Row) => {
    setBusy(r.id); setErr(null);
    const next = r.status === 'active' ? 'inactive' : 'active';
    const { error } = await supabase.from('employees').update({ status: next }).eq('id', r.id);
    if (error) setErr(error.message);
    setBusy(null);
    load();
  };

  // Search across name + email + employee code + department + manager.
  // Matches any token-substring case-insensitively.
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q && scope === 'all') return rows;
    return rows.filter(r => {
      if (scope === 'admins'   && !r.isAdmin) return false;
      if (scope === 'learners' && r.isAdmin) return false;
      if (scope === 'inactive' && r.status !== 'inactive') return false;
      if (!q) return true;
      const hay = `${r.full_name} ${r.email} ${r.employeeCode ?? ''} ${r.department ?? ''} ${r.managerName ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [rows, search, scope]);

  const admins = filteredRows.filter(r => r.isAdmin);
  const others = filteredRows.filter(r => !r.isAdmin);
  const totalAdmins = rows.filter(r => r.isAdmin).length;
  const totalOthers = rows.filter(r => !r.isAdmin).length;
  const inactive = rows.filter(r => r.status === 'inactive');

  return (
    <div style={{padding:'28px 36px 48px', animation:'fadeUp .3s'}}>
      <div style={{marginBottom:20, display:'flex', alignItems:'center', gap:12, flexWrap:'wrap'}}>
        <div>
          <h2 style={{fontSize:22, color:'#0A1F3D', margin:0, letterSpacing:'-.02em', fontWeight:800}}>People & access</h2>
          <div style={{fontSize:13, color:'#5B6A7D', marginTop:4}}>
            {totalAdmins} admin{totalAdmins===1?'':'s'} · {totalOthers} learner{totalOthers===1?'':'s'} · {inactive.length} disabled · {rows.filter(r => !r.hasLoggedIn).length} pending first login
          </div>
        </div>
        <div style={{marginLeft:'auto', display:'flex', alignItems:'center', gap:8, flexWrap:'wrap'}}>
          {(['all', 'admins', 'learners', 'inactive'] as const).map(s => (
            <button
              key={s}
              onClick={() => setScope(s)}
              style={{
                padding:'7px 12px', fontSize:12, fontWeight:700, borderRadius:8, cursor:'pointer',
                border:`1px solid ${scope===s ? '#0072FF' : '#DDE4ED'}`,
                background: scope===s ? '#E6F4FF' : '#fff',
                color: scope===s ? '#0072FF' : '#5B6A7D',
                textTransform:'capitalize',
              }}
            >{s}</button>
          ))}
          <div style={{position:'relative'}}>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search name, email, ID, department…"
              style={{padding:'9px 14px 9px 34px', border:'1px solid #DDE4ED', borderRadius:10, fontSize:13, minWidth:300, outline:'none', background:'#fff'}}
            />
            <span style={{position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', fontSize:14, color:'#8A97A8'}}>🔍</span>
            {search && (
              <button onClick={() => setSearch('')} style={{position:'absolute', right:8, top:'50%', transform:'translateY(-50%)', background:'transparent', border:0, color:'#8A97A8', fontSize:14, cursor:'pointer'}} title="Clear">✕</button>
            )}
          </div>
        </div>
      </div>
      {err && <div style={{padding:'10px 12px', background:'#FCE1DE', color:'#C2261D', borderRadius:8, fontSize:13, fontWeight:500, marginBottom:14}}>{err}</div>}
      {flash && <div style={{padding:'10px 12px', background:'#E6F4FF', color:'#0F4F8B', border:'1px solid #BBE0FF', borderRadius:8, fontSize:13, fontWeight:500, marginBottom:14}}>{flash}</div>}

      {loading ? <Card pad={24} style={{color:'#5B6A7D', fontSize:13}}>Loading…</Card>
       : rows.length === 0 ? <EmptyState icon="👤" title="No employees yet" sub="Sync from Darwin or seed the org table to get started."/>
       : filteredRows.length === 0 ? (
         <Card pad={28} style={{textAlign:'center'}}>
           <div style={{fontSize:32, marginBottom:8}}>🔍</div>
           <div style={{fontSize:14, fontWeight:700, color:'#0A1F3D'}}>No matches</div>
           <div style={{fontSize:12, color:'#5B6A7D', marginTop:4}}>Try a different search term or clear the filter.</div>
           <div style={{marginTop:12}}>
             <Btn size="sm" variant="ghost" onClick={() => { setSearch(''); setScope('all'); }}>Clear filters</Btn>
           </div>
         </Card>
       ) : (
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:16}}>
          <Card pad={0}>
            <div style={{padding:'14px 18px', borderBottom:'1px solid #EEF2F7', display:'flex', alignItems:'center'}}>
              <div style={{fontSize:14, fontWeight:700, color:'#0A1F3D'}}>Admins</div>
              <Chip color="#C2261D" style={{marginLeft:'auto'}}>{admins.length}{search || scope!=='all' ? ` of ${totalAdmins}` : ''}</Chip>
            </div>
            <div style={{maxHeight:520, overflowY:'auto'}}>
              {admins.length === 0 ? <div style={{padding:24, fontSize:13, color:'#8A97A8', textAlign:'center'}}>No matching admins.</div>
               : admins.map(r => <UserRow key={r.id} r={r} busy={busy===r.id} onToggleAdmin={()=>toggleAdmin(r)} onToggleActive={()=>toggleActive(r)}/>)}
            </div>
          </Card>
          <Card pad={0}>
            <div style={{padding:'14px 18px', borderBottom:'1px solid #EEF2F7', display:'flex', alignItems:'center'}}>
              <div style={{fontSize:14, fontWeight:700, color:'#0A1F3D'}}>Employees</div>
              <Chip color="#0072FF" style={{marginLeft:'auto'}}>{others.length}{search || scope!=='all' ? ` of ${totalOthers}` : ''}</Chip>
            </div>
            <div style={{maxHeight:520, overflowY:'auto'}}>
              {others.length === 0 ? <div style={{padding:24, fontSize:13, color:'#8A97A8', textAlign:'center'}}>No matching employees.</div>
               : others.map(r => <UserRow key={r.id} r={r} busy={busy===r.id} onToggleAdmin={()=>toggleAdmin(r)} onToggleActive={()=>toggleActive(r)}/>)}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function UserRow({ r, busy, onToggleAdmin, onToggleActive }: { r: Row; busy: boolean; onToggleAdmin: () => void; onToggleActive: () => void }) {
  return (
    <div style={{padding:'12px 18px', display:'flex', alignItems:'center', gap:12, borderBottom:'1px solid #F7F9FC', opacity: r.status === 'inactive' ? 0.55 : 1}}>
      <Avatar name={r.full_name || r.email} size={32}/>
      <div style={{flex:1, minWidth:0}}>
        <div style={{fontSize:13, fontWeight:600, color:'#0A1F3D', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
          {r.full_name || r.email}
          {r.status !== 'active' && (
            <span style={{marginLeft:8, fontSize:10, fontWeight:700, color:'#8A97A8', background:'#F7F9FC', padding:'2px 6px', borderRadius:4}}>{r.status.toUpperCase()}</span>
          )}
          {!r.hasLoggedIn && r.status === 'active' && (
            <span style={{marginLeft:8, fontSize:10, fontWeight:700, color:'#E08A1E', background:'#FFF6E6', padding:'2px 6px', borderRadius:4}} title="Imported from Darwin but has not signed in to the portal yet.">PENDING LOGIN</span>
          )}
        </div>
        <div style={{fontSize:11, color:'#5B6A7D', display:'flex', gap:8, flexWrap:'wrap', alignItems:'center'}}>
          <span>{r.email}</span>
          {r.employeeCode && <code style={{fontSize:10, background:'#F2F9FF', padding:'1px 5px', borderRadius:3, color:'#0072FF', fontWeight:700}}>{r.employeeCode}</code>}
          {r.department && <span>· {r.department}</span>}
          {r.managerName && <span>· mgr: {r.managerName}</span>}
          {r.lastLoginAt && <span>· last login {new Date(r.lastLoginAt).toLocaleDateString()}</span>}
        </div>
      </div>
      <Btn size="sm" variant={r.isAdmin?'danger':'soft'} disabled={busy} onClick={onToggleAdmin}>
        {busy ? '…' : r.isAdmin ? 'Revoke admin' : 'Make admin'}
      </Btn>
      <Btn size="sm" variant="ghost" disabled={busy} onClick={onToggleActive}>
        {r.status === 'active' ? 'Disable' : 'Enable'}
      </Btn>
    </div>
  );
}
