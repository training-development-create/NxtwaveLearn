// Admins page: promote/demote admin users
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Btn, Card, Chip, EmptyState, Avatar } from "./ui";

type Row = { id: string; email: string; full_name: string; isAdmin: boolean };

export function AdminAdmins() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const [{ data: ps }, { data: rs }] = await Promise.all([
      supabase.from('profiles').select('id, email, full_name'),
      supabase.from('user_roles').select('user_id, role').eq('role', 'admin'),
    ]);
    const adminIds = new Set((rs || []).map((r: { user_id: string }) => r.user_id));
    setRows((ps || []).map((p: { id: string; email: string; full_name: string }) => ({
      id: p.id, email: p.email, full_name: p.full_name, isAdmin: adminIds.has(p.id),
    })));
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const toggle = async (r: Row) => {
    setBusy(r.id); setErr(null);
    const fn = r.isAdmin ? 'demote_admin' : 'promote_to_admin';
    const { error } = await supabase.rpc(fn, { _email: r.email });
    if (error) setErr(error.message);
    setBusy(null);
    load();
  };

  const admins = rows.filter(r => r.isAdmin);
  const learners = rows.filter(r => !r.isAdmin);

  return (
    <div style={{padding:'28px 36px 48px', animation:'fadeUp .3s'}}>
      <div style={{marginBottom:20}}>
        <h2 style={{fontSize:22, color:'#0A1F3D', margin:0, letterSpacing:'-.02em', fontWeight:800}}>Admin access</h2>
        <div style={{fontSize:13, color:'#5B6A7D', marginTop:4}}>Promote learners to admins or revoke admin access. {admins.length} admin{admins.length===1?'':'s'} · {learners.length} learner{learners.length===1?'':'s'}.</div>
      </div>
      {err && <div style={{padding:'10px 12px', background:'#FCE1DE', color:'#C2261D', borderRadius:8, fontSize:13, fontWeight:500, marginBottom:14}}>{err}</div>}

      {loading ? <Card pad={24} style={{color:'#5B6A7D', fontSize:13}}>Loading…</Card>
       : rows.length === 0 ? <EmptyState icon="👤" title="No users yet" sub="Once people sign up, you can manage their access here."/>
       : (
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:16}}>
          <Card pad={0}>
            <div style={{padding:'14px 18px', borderBottom:'1px solid #EEF2F7', display:'flex', alignItems:'center'}}>
              <div style={{fontSize:14, fontWeight:700, color:'#0A1F3D'}}>Admins</div>
              <Chip color="#C2261D" style={{marginLeft:'auto'}}>{admins.length}</Chip>
            </div>
            {admins.length === 0 ? <div style={{padding:24, fontSize:13, color:'#8A97A8', textAlign:'center'}}>No other admins yet.</div>
             : admins.map(r => <UserRow key={r.id} r={r} busy={busy===r.id} onToggle={()=>toggle(r)}/>)}
          </Card>
          <Card pad={0}>
            <div style={{padding:'14px 18px', borderBottom:'1px solid #EEF2F7', display:'flex', alignItems:'center'}}>
              <div style={{fontSize:14, fontWeight:700, color:'#0A1F3D'}}>Learners</div>
              <Chip color="#0072FF" style={{marginLeft:'auto'}}>{learners.length}</Chip>
            </div>
            <div style={{maxHeight:520, overflowY:'auto'}}>
              {learners.map(r => <UserRow key={r.id} r={r} busy={busy===r.id} onToggle={()=>toggle(r)}/>)}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function UserRow({ r, busy, onToggle }: { r: Row; busy: boolean; onToggle: () => void }) {
  return (
    <div style={{padding:'12px 18px', display:'flex', alignItems:'center', gap:12, borderBottom:'1px solid #F7F9FC'}}>
      <Avatar name={r.full_name || r.email} size={32}/>
      <div style={{flex:1, minWidth:0}}>
        <div style={{fontSize:13, fontWeight:600, color:'#0A1F3D', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{r.full_name || r.email}</div>
        <div style={{fontSize:11, color:'#5B6A7D'}}>{r.email}</div>
      </div>
      <Btn size="sm" variant={r.isAdmin?'danger':'soft'} disabled={busy} onClick={onToggle}>
        {busy ? '…' : r.isAdmin ? 'Revoke' : 'Make admin'}
      </Btn>
    </div>
  );
}
