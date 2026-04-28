// Admins page: promote/demote admin users + soft-disable employees.
// Sourced from public.employees (the org-aware table). is_admin is a column
// on employees, not a separate user_roles row.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Btn, Card, Chip, EmptyState, Avatar } from "./ui";

type Row = {
  id: string;                       // employees.id
  email: string;
  full_name: string;
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

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('employees')
      .select(`
        id, email, name, is_admin, status, auth_user_id, last_login_at,
        departments:department_id ( name ),
        manager:manager_id ( name )
      `)
      .order('name', { ascending: true });
    if (error) { setErr(error.message); setLoading(false); return; }
    type EmpRow = { id: string; email: string; name: string; is_admin: boolean; status: Row['status']; auth_user_id: string | null; last_login_at: string | null; departments: { name: string } | null; manager: { name: string } | null };
    setRows(((data || []) as unknown as EmpRow[]).map(r => ({
      id: r.id,
      email: r.email,
      full_name: r.name || r.email,
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

  const toggleAdmin = async (r: Row) => {
    setBusy(r.id); setErr(null);
    const { error } = await supabase.from('employees').update({ is_admin: !r.isAdmin }).eq('id', r.id);
    if (error) setErr(error.message);
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

  const admins = rows.filter(r => r.isAdmin);
  const others = rows.filter(r => !r.isAdmin);
  const inactive = rows.filter(r => r.status === 'inactive');

  return (
    <div style={{padding:'28px 36px 48px', animation:'fadeUp .3s'}}>
      <div style={{marginBottom:20, display:'flex', alignItems:'center', gap:12}}>
        <div>
          <h2 style={{fontSize:22, color:'#0A1F3D', margin:0, letterSpacing:'-.02em', fontWeight:800}}>People & access</h2>
          <div style={{fontSize:13, color:'#5B6A7D', marginTop:4}}>
            {admins.length} admin{admins.length===1?'':'s'} · {others.length} learner{others.length===1?'':'s'} · {inactive.length} disabled · {rows.filter(r => !r.hasLoggedIn).length} pending first login
          </div>
        </div>
      </div>
      {err && <div style={{padding:'10px 12px', background:'#FCE1DE', color:'#C2261D', borderRadius:8, fontSize:13, fontWeight:500, marginBottom:14}}>{err}</div>}

      {loading ? <Card pad={24} style={{color:'#5B6A7D', fontSize:13}}>Loading…</Card>
       : rows.length === 0 ? <EmptyState icon="👤" title="No employees yet" sub="Sync from Darwin or seed the org table to get started."/>
       : (
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:16}}>
          <Card pad={0}>
            <div style={{padding:'14px 18px', borderBottom:'1px solid #EEF2F7', display:'flex', alignItems:'center'}}>
              <div style={{fontSize:14, fontWeight:700, color:'#0A1F3D'}}>Admins</div>
              <Chip color="#C2261D" style={{marginLeft:'auto'}}>{admins.length}</Chip>
            </div>
            {admins.length === 0 ? <div style={{padding:24, fontSize:13, color:'#8A97A8', textAlign:'center'}}>No other admins yet.</div>
             : admins.map(r => <UserRow key={r.id} r={r} busy={busy===r.id} onToggleAdmin={()=>toggleAdmin(r)} onToggleActive={()=>toggleActive(r)}/>)}
          </Card>
          <Card pad={0}>
            <div style={{padding:'14px 18px', borderBottom:'1px solid #EEF2F7', display:'flex', alignItems:'center'}}>
              <div style={{fontSize:14, fontWeight:700, color:'#0A1F3D'}}>Employees</div>
              <Chip color="#0072FF" style={{marginLeft:'auto'}}>{others.length}</Chip>
            </div>
            <div style={{maxHeight:520, overflowY:'auto'}}>
              {others.map(r => <UserRow key={r.id} r={r} busy={busy===r.id} onToggleAdmin={()=>toggleAdmin(r)} onToggleActive={()=>toggleActive(r)}/>)}
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
        <div style={{fontSize:11, color:'#5B6A7D', display:'flex', gap:8, flexWrap:'wrap'}}>
          <span>{r.email}</span>
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
