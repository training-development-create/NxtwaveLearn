import React, { useState, type CSSProperties, type ReactNode, type MouseEvent } from "react";
import type { Profile } from "./auth";
import { NotificationBell } from "./NotificationBell";

export const NAV_LEARNER = [
  { id:'courses', label:'My compliance courses', icon:'M4 5a2 2 0 012-2h3l2 2h9a2 2 0 012 2v11a2 2 0 01-2 2H4V5z' },
];
export const NAV_ADMIN = [
  { id:'admin-analytics', label:'Analytics', icon:'M3 3v18h18M7 14l3-3 3 3 5-6' },
  { id:'admin-modules', label:'Modules', icon:'M4 6h16M4 12h16M4 18h10' },
  { id:'admin-upload', label:'Upload & Assessment', icon:'M4 16v3a2 2 0 002 2h12a2 2 0 002-2v-3M12 4v13M6 10l6-6 6 6' },
  { id:'admin-admins', label:'Admins', icon:'M16 11a4 4 0 10-8 0 4 4 0 008 0zM2 21v-1a6 6 0 0112 0v1' },
];

export function Icon({ d, size=18, stroke=1.8, color='currentColor' }: { d:string; size?:number; stroke?:number; color?:string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round"><path d={d}/></svg>;
}

export function Sidebar({ role, active, onNav, profile }: { role:'learner'|'admin'; active:string; onNav:(id:string)=>void; profile: Profile }) {
  const items = role==='admin' ? NAV_ADMIN : NAV_LEARNER;
  return (
    <aside style={sb.wrap}>
      <div style={sb.logoWrap}>
        <img src="/assets/nxtwave-colored.svg" style={{height:24}} alt="NxtWave"/>
        <div style={{fontSize:10, fontWeight:600, letterSpacing:'.1em', color:'#5B6A7D', marginTop:6, textTransform:'uppercase'}}>{role==='admin'?'Compliance Admin':'Compliance Training'}</div>
      </div>
      <nav style={{padding:'10px 10px', flex:1}}>
        {items.map(it=>(
          <button key={it.id} onClick={()=>onNav(it.id)} style={{...sb.item, ...(active===it.id?sb.itemActive:{})}}>
            <Icon d={it.icon}/>
            <span>{it.label}</span>
            {active===it.id && <span style={sb.dot}/>}
          </button>
        ))}
      </nav>
      <div style={sb.userBlock}>
        <Avatar src={profile.avatar_url} name={profile.full_name || profile.email} size={32}/>
        <div style={{minWidth:0, flex:1}}>
          <div title={profile.full_name || profile.email} style={{fontSize:13, fontWeight:700, color:'#0A1F3D', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{profile.full_name || profile.email}</div>
          <div title={profile.email} style={{fontSize:11, color:'#5B6A7D', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{profile.email}</div>
          {profile.employee_id && (
            <div style={{fontSize:10, color:'#0072FF', fontWeight:700, fontFamily:'monospace', marginTop:2}}>ID: {profile.employee_id}</div>
          )}
        </div>
      </div>
      <button onClick={()=>onNav('logout')} style={{margin:'0 14px 18px', padding:'9px 12px', background:'#fff', border:'1px solid #EEF2F7', borderRadius:10, color:'#5B6A7D', fontSize:13, fontWeight:600, cursor:'pointer'}}>Sign out</button>
    </aside>
  );
}

const sb: Record<string, CSSProperties> = {
  wrap: { width:240, background:'#fff', borderRight:'1px solid #EEF2F7', display:'flex', flexDirection:'column', position:'sticky', top:0, height:'100vh' },
  logoWrap: { padding:'22px 20px 18px', borderBottom:'1px solid #EEF2F7' },
  item: { position:'relative', display:'flex', alignItems:'center', gap:12, width:'100%', padding:'11px 12px', borderRadius:10, background:'transparent', border:0, color:'#3B4A5E', fontSize:14, fontWeight:500, cursor:'pointer', textAlign:'left', marginBottom:2, transition:'all .15s' },
  itemActive: { background:'linear-gradient(90deg, #E6F4FF, #F2F9FF)', color:'#0072FF', fontWeight:600 },
  dot: { marginLeft:'auto', width:6, height:6, borderRadius:99, background:'#0072FF' },
  userBlock: { margin:'0 14px 10px', padding:'10px 12px', display:'flex', alignItems:'center', gap:10, background:'#F7F9FC', borderRadius:10, border:'1px solid #EEF2F7' },
};

export function Topbar({ title, subtitle, children, profile }: { title:string; subtitle?:string; children?:ReactNode; profile?: Profile }) {
  return (
    <header style={{ display:'flex', alignItems:'center', gap:16, padding:'22px 36px 18px', borderBottom:'1px solid #EEF2F7', background:'#fff', position:'sticky', top:0, zIndex:3 }}>
      <div>
        <h1 style={{fontSize:26, color:'#002A4B', letterSpacing:'-.02em', margin:0, fontWeight:800}}>{title}</h1>
        {subtitle && <div style={{color:'#5B6A7D', fontSize:14, marginTop:4}}>{subtitle}</div>}
      </div>
      <div style={{marginLeft:'auto', display:'flex', alignItems:'center', gap:14}}>
        {children}
        <NotificationBell/>
        {profile && (
          <div style={{display:'flex', alignItems:'center', gap:10}}>
            <div style={{textAlign:'right', minWidth:0, maxWidth:240}}>
              <div title={profile.full_name || profile.email} style={{fontSize:13, fontWeight:700, color:'#0A1F3D', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{profile.full_name || profile.email}</div>
              <div style={{fontSize:11, color:'#5B6A7D', display:'flex', gap:8, justifyContent:'flex-end', alignItems:'center'}}>
                <span title={profile.email} style={{overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:160}}>{profile.email}</span>
                {profile.employee_id && (
                  <code style={{fontSize:10, background:'#F2F9FF', padding:'2px 6px', borderRadius:4, color:'#0072FF', fontWeight:700}}>{profile.employee_id}</code>
                )}
              </div>
            </div>
            <div style={{ position:'relative' }}>
              <Avatar src={profile.avatar_url} name={profile.full_name || profile.email} size={38}/>
              <span style={{ position:'absolute', right:-1, bottom:-1, width:11, height:11, borderRadius:99, background:'#17A674', border:'2px solid #fff' }}/>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}

type BtnProps = {
  children: ReactNode;
  variant?: 'primary'|'ghost'|'soft'|'dark'|'success'|'danger';
  size?: 'sm'|'md'|'lg';
  full?: boolean;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  icon?: ReactNode;
  style?: CSSProperties;
};

export function Btn({ children, variant='primary', size='md', full, onClick, disabled, icon, style }: BtnProps) {
  const sizes: Record<string, CSSProperties> = {
    sm: { padding:'8px 14px', fontSize:13, borderRadius:10 },
    md: { padding:'11px 20px', fontSize:14, borderRadius:12 },
    lg: { padding:'14px 24px', fontSize:15, borderRadius:12 },
  };
  const variants: Record<string, CSSProperties> = {
    primary: { background:'linear-gradient(90deg,#00C6FF,#0072FF)', color:'#fff', border:'none', boxShadow:'0 8px 22px rgba(0,114,255,.32)' },
    ghost: { background:'#fff', color:'#002A4B', border:'1px solid #DDE4ED' },
    soft: { background:'#E6F4FF', color:'#0072FF', border:'1px solid #CCEAFF' },
    dark: { background:'#002A4B', color:'#fff', border:'none' },
    success: { background:'#17A674', color:'#fff', border:'none', boxShadow:'0 8px 22px rgba(23,166,116,.3)' },
    danger: { background:'#fff', color:'#C2261D', border:'1px solid #FCE1DE' },
  };
  return (
    <button onClick={onClick} disabled={disabled} style={{
      ...sizes[size], ...variants[variant],
      display:'inline-flex', alignItems:'center', justifyContent:'center', gap:8,
      fontWeight:600, cursor: disabled?'not-allowed':'pointer', opacity: disabled?.5:1,
      transition:'transform .1s ease, box-shadow .15s', width: full?'100%':'auto',
      ...style,
    }}>
      {icon}{children}
    </button>
  );
}

export function Card({ children, pad=24, style, onClick }: { children:ReactNode; pad?:number; style?:CSSProperties; onClick?:()=>void }) {
  return <div onClick={onClick} style={{background:'#fff', borderRadius:16, border:'1px solid #EEF2F7', boxShadow:'0 2px 6px rgba(0,42,75,.04)', padding:pad, ...style}}>{children}</div>;
}

export function Chip({ children, color='#0072FF', bg, style }: { children:ReactNode; color?:string; bg?:string; style?:CSSProperties }) {
  return <span style={{
    display:'inline-flex', alignItems:'center', gap:6,
    padding:'4px 10px', borderRadius:999, fontSize:12, fontWeight:600,
    color, background: bg || (color+'22'), ...style,
  }}>{children}</span>;
}

export function ProgressBar({ value, height=8, color='linear-gradient(90deg,#00C6FF,#0072FF)', bg='#EEF2F7', showLabel }: { value:number; height?:number; color?:string; bg?:string; showLabel?:boolean }) {
  return (
    <div style={{display:'flex', alignItems:'center', gap:10}}>
      <div style={{flex:1, height, background:bg, borderRadius:999, overflow:'hidden', position:'relative'}}>
        <div style={{width:`${value}%`, height:'100%', background:color, borderRadius:999, transition:'width .6s cubic-bezier(.2,.7,.2,1)'}}/>
      </div>
      {showLabel && <div style={{fontSize:12, fontWeight:700, color:'#3B4A5E', minWidth:38, textAlign:'right'}}>{value}%</div>}
    </div>
  );
}

export function Avatar({ src, name, size=32, ring }: { src?: string | null; name?: string; size?:number; ring?:string }) {
  if (src) return <img src={src} alt="" style={{width:size, height:size, borderRadius:99, objectFit:'cover', border: ring?`2px solid ${ring}`:'none', boxShadow: ring?`0 0 0 2px #fff`:'none'}}/>;
  return <InitialAvatar name={name || '?'} size={size} ring={ring}/>;
}

export function InitialAvatar({ name, size=32, ring }: { name: string; size?: number; ring?: string }) {
  const initials = (name || '?').trim().split(/\s+/).slice(0,2).map(s => s[0]?.toUpperCase() || '').join('') || '?';
  // hash-based subtle background tint
  const seed = (name || '?').split('').reduce((a,c) => a + c.charCodeAt(0), 0);
  const palette = [
    { bg:'#E6F4FF', fg:'#0072FF' }, { bg:'#E9F8F1', fg:'#17A674' }, { bg:'#FDF1E6', fg:'#E08A1E' },
    { bg:'#F2EBFC', fg:'#A855F7' }, { bg:'#FCEBF1', fg:'#EC4899' }, { bg:'#E8EEF7', fg:'#134594' },
  ];
  const c = palette[seed % palette.length];
  return (
    <div style={{width:size, height:size, borderRadius:99, background:c.bg, color:c.fg, display:'grid', placeItems:'center', fontSize: Math.round(size*0.42), fontWeight:800, border: ring?`2px solid ${ring}`:'none', boxShadow: ring?`0 0 0 2px #fff`:'none', flexShrink:0}}>{initials}</div>
  );
}

export function Spark({ values, color='#0072FF', h=40, w=120 }: { values:number[]; color?:string; h?:number; w?:number }) {
  if (!values.length) values = [0,0];
  const max = Math.max(...values, 1);
  const pts = values.map((v,i)=>{
    const x = (i/Math.max(values.length-1,1))*w;
    const y = h - (v/max)*h*0.9 - 4;
    return `${x},${y}`;
  }).join(' ');
  const id = `g${color.replace('#','')}`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={color} stopOpacity=".25"/><stop offset="1" stopColor={color} stopOpacity="0"/>
      </linearGradient></defs>
      <polygon points={`0,${h} ${pts} ${w},${h}`} fill={`url(#${id})`}/>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

export function Field({ label, type='text', value, onChange, hint, mono }: { label:string; type?:string; value:string; onChange:(e:React.ChangeEvent<HTMLInputElement>)=>void; hint?:string; mono?:boolean }) {
  const [f, setF] = useState(false);
  return (
    <label style={{display:'block', position:'relative'}}>
      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6}}>
        <div style={{fontSize:12, fontWeight:600, color:'#3B4A5E'}}>{label}</div>
        {hint && <div style={{fontSize:11, color:'#8A97A8'}}>{hint}</div>}
      </div>
      <input type={type} value={value} onChange={onChange} onFocus={()=>setF(true)} onBlur={()=>setF(false)}
        style={{width:'100%', padding:'11px 14px', fontSize:14, border:`1px solid ${f?'#0072FF':'#DDE4ED'}`, borderRadius:10, outline:'none', background:'#fff', boxShadow: f?'0 0 0 4px rgba(0,114,255,.10)':'none', transition:'all .15s', fontFamily: mono?'ui-monospace, SFMono-Regular, Menlo, monospace':'inherit', letterSpacing: mono?'.02em':'normal'}}/>
    </label>
  );
}

export function EmptyState({ icon='📭', title, sub, action }: { icon?:string; title:string; sub:string; action?: ReactNode }) {
  return (
    <div style={{padding:'60px 24px', textAlign:'center', background:'#fff', border:'1px dashed #DDE4ED', borderRadius:14}}>
      <div style={{fontSize:40, marginBottom:10}}>{icon}</div>
      <div style={{fontSize:16, fontWeight:700, color:'#0A1F3D'}}>{title}</div>
      <div style={{fontSize:13, color:'#5B6A7D', marginTop:6, maxWidth:420, marginLeft:'auto', marginRight:'auto', lineHeight:1.5}}>{sub}</div>
      {action && <div style={{marginTop:18}}>{action}</div>}
    </div>
  );
}
