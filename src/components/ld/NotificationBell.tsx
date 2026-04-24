// Notifications bell + dropdown for the topbar
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./auth";
import { Icon } from "./ui";

type Notif = { id: string; title: string; body: string; read: boolean; created_at: string; link_course_id: string | null };

export function NotificationBell() {
  const { user } = useAuth();
  const [items, setItems] = useState<Notif[]>([]);
  const [open, setOpen] = useState(false);

  const load = async () => {
    if (!user) return;
    const { data } = await supabase.from('notifications')
      .select('id, title, body, read, created_at, link_course_id')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20);
    setItems((data || []) as Notif[]);
  };

  useEffect(() => {
    load();
    if (!user) return;
    const ch = supabase.channel('notif-' + user.id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const unread = items.filter(i => !i.read).length;

  const markAllRead = async () => {
    if (!user || unread === 0) return;
    await supabase.from('notifications').update({ read: true }).eq('user_id', user.id).eq('read', false);
    load();
  };

  return (
    <div style={{position:'relative'}}>
      <button onClick={()=>{ setOpen(o=>!o); if (!open) markAllRead(); }} style={{ width:38, height:38, borderRadius:10, border:'1px solid #EEF2F7', background:'#fff', cursor:'pointer', display:'grid', placeItems:'center', color:'#3B4A5E', position:'relative' }}>
        <Icon d="M15 17h5l-2-2v-5a6 6 0 10-12 0v5l-2 2h5m4 0v1a2 2 0 11-4 0v-1"/>
        {unread > 0 && (
          <span style={{position:'absolute', top:6, right:6, minWidth:16, height:16, padding:'0 4px', borderRadius:99, background:'#E23D31', color:'#fff', fontSize:10, fontWeight:700, display:'grid', placeItems:'center', border:'2px solid #fff'}}>{unread}</span>
        )}
      </button>
      {open && (
        <>
          <div onClick={()=>setOpen(false)} style={{position:'fixed', inset:0, zIndex:8}}/>
          <div style={{position:'absolute', right:0, top:46, width:340, background:'#fff', border:'1px solid #EEF2F7', borderRadius:12, boxShadow:'0 12px 32px rgba(0,42,75,.12)', zIndex:9, overflow:'hidden'}}>
            <div style={{padding:'12px 16px', borderBottom:'1px solid #EEF2F7', display:'flex', alignItems:'center'}}>
              <div style={{fontSize:13, fontWeight:700, color:'#0A1F3D'}}>Notifications</div>
              <div style={{marginLeft:'auto', fontSize:11, color:'#8A97A8'}}>{items.length} total</div>
            </div>
            <div style={{maxHeight:400, overflowY:'auto'}}>
              {items.length === 0 ? (
                <div style={{padding:30, textAlign:'center', fontSize:13, color:'#8A97A8'}}>No notifications yet</div>
              ) : items.map(n => (
                <div key={n.id} style={{padding:'12px 16px', borderBottom:'1px solid #F7F9FC', background: n.read?'#fff':'#F7FBFF'}}>
                  <div style={{fontSize:13, fontWeight:700, color:'#0A1F3D'}}>{n.title}</div>
                  <div style={{fontSize:12, color:'#5B6A7D', marginTop:2}}>{n.body}</div>
                  <div style={{fontSize:10, color:'#8A97A8', marginTop:4}}>{new Date(n.created_at).toLocaleString()}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
