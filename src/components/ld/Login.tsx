import { useState } from "react";
import { Btn, Field } from "./ui";
import { useAuth } from "./auth";

export function Login() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'login'|'signup'>('login');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [empId, setEmpId] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async () => {
    setLoading(true); setError(null); setNotice(null);
    if (mode === 'signup') {
      if (!name.trim()) { setError('Please enter your name.'); setLoading(false); return; }
      if (!empId.trim()) { setError('Employee ID is required.'); setLoading(false); return; }
      const { error } = await signUp({
        email: email.trim(), password: pw,
        full_name: name.trim(), employee_id: empId.trim(),
      });
      if (error) setError(error);
      else {
        // Do not auto sign-in here; it can show confusing "confirm email" errors
        // in projects where email confirmation is enabled.
        setNotice('Account created successfully. Please sign in.');
        setMode('login');
      }
    } else {
      const { error } = await signIn(email.trim(), pw);
      if (error) setError(error);
    }
    setLoading(false);
  };

  const isSignup = mode === 'signup';

  return (
    <div style={{minHeight:'100vh', display:'grid', gridTemplateColumns:'1.1fr 1fr', background:'#fff'}}>
      {/* LEFT — hero / brand */}
      <div style={{background:'#0A1F3D', position:'relative', overflow:'hidden', padding:'56px 64px', display:'flex', flexDirection:'column', justifyContent:'space-between', color:'#fff'}}>
        <Blob top="-100px" right="-80px" size={380} c="#0072FF" o={.28}/>
        <Blob bottom="-140px" left="-80px" size={320} c="#00C6FF" o={.18}/>
        <div style={{position:'absolute', inset:0, backgroundImage:'radial-gradient(circle, rgba(255,255,255,.05) 1px, transparent 1px)', backgroundSize:'22px 22px', opacity:.4}}/>

        <div style={{position:'relative', zIndex:1, display:'flex', alignItems:'center', gap:14}}>
          <img src="/assets/nxtwave-white.svg" style={{height:30}} alt="NxtWave"/>
          <div style={{width:1, height:22, background:'rgba(255,255,255,.25)'}}/>
          <div style={{fontSize:13, fontWeight:600, letterSpacing:'.16em', color:'#9EC9F0', textTransform:'uppercase'}}>Learning Portal</div>
        </div>

        <div style={{position:'relative', zIndex:1, maxWidth:480}}>
          <h1 style={{fontSize:54, lineHeight:1.05, color:'#fff', margin:0, fontWeight:800, letterSpacing:'-.025em'}}>
            Learn what matters.<br/>
            <span style={{color:'#33B6FF'}}>Grow without limits.</span>
          </h1>
          <p style={{color:'#9EC9F0', fontSize:15, marginTop:18, lineHeight:1.55, maxWidth:440}}>
            One portal for every course your team needs — from compliance to leadership — with tracked progress.
          </p>
        </div>

        <div style={{position:'relative', zIndex:1, fontSize:12, color:'#7FDBFF', letterSpacing:'.06em'}}>NXTWAVE · LEARNING & DEVELOPMENT</div>
      </div>

      {/* RIGHT — form */}
      <div style={{padding:'56px 72px', display:'flex', flexDirection:'column', justifyContent:'center'}}>
        <div style={{maxWidth:400, width:'100%'}}>
          <div style={{fontSize:11, fontWeight:700, color:'#8A97A8', letterSpacing:'.1em', textTransform:'uppercase', marginBottom:8}}>Welcome</div>
          <h2 style={{fontSize:30, lineHeight:1.15, color:'#0A1F3D', letterSpacing:'-.02em', margin:0, fontWeight:800}}>
            {isSignup ? 'Create your account' : 'Sign in to continue'}
          </h2>
          <p style={{color:'#5B6A7D', fontSize:14, marginTop:8}}>
            {isSignup ? 'Use your work email to get started. All new accounts are learners by default.' : 'Use your work email and password.'}
          </p>

          <div style={{marginTop:20, display:'inline-flex', padding:3, background:'#F7F9FC', border:'1px solid #EEF2F7', borderRadius:10}}>
            {([['login','Sign in'],['signup','Sign up']] as const).map(([k,l])=>(
              <button key={k} onClick={()=>{setMode(k); setError(null);}} style={{padding:'7px 18px', fontSize:13, fontWeight:600, border:0, borderRadius:8, cursor:'pointer', background: mode===k?'#fff':'transparent', color: mode===k?'#002A4B':'#5B6A7D', boxShadow: mode===k?'0 1px 2px rgba(0,42,75,.08)':'none'}}>{l}</button>
            ))}
          </div>

          <div style={{marginTop:20, display:'flex', flexDirection:'column', gap:12}}>
            {isSignup && <Field label="Full name" value={name} onChange={e=>setName(e.target.value)}/>}
            <Field label="Work email" value={email} onChange={e=>setEmail(e.target.value)}/>
            {isSignup && (
              <Field label="Employee ID *" value={empId} onChange={e=>setEmpId(e.target.value.toUpperCase())} mono/>
            )}
            <Field label="Password" type="password" value={pw} onChange={e=>setPw(e.target.value)} hint={isSignup ? 'Min 6 characters' : undefined}/>
          </div>

          {notice && (
            <div style={{marginTop:14, padding:'10px 12px', background:'#E8F7EF', color:'#0F7C57', borderRadius:8, fontSize:13, fontWeight:500}}>{notice}</div>
          )}

          {error && (
            <div style={{marginTop:14, padding:'10px 12px', background:'#FCE1DE', color:'#C2261D', borderRadius:8, fontSize:13, fontWeight:500}}>{error}</div>
          )}

          <div style={{marginTop:18}}>
            <Btn full size="lg" onClick={submit} disabled={loading || !email || !pw || (isSignup && (!name.trim() || !empId.trim()))}>
              {loading
                ? <span style={{display:'inline-block', width:16, height:16, border:'2px solid rgba(255,255,255,.35)', borderTopColor:'#fff', borderRadius:99, animation:'spin .7s linear infinite'}}/>
                : (isSignup ? 'Create account' : 'Sign in')}
            </Btn>
          </div>

          {isSignup && (
            <div style={{marginTop:16, fontSize:12, color:'#8A97A8', lineHeight:1.5}}>
              Admin access is granted by an existing admin from the Admins page after you sign up.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ v, l }: { v:string; l:string }) {
  return <div><div style={{fontSize:22, fontWeight:800, color:'#fff', letterSpacing:'-.02em'}}>{v}</div><div>{l}</div></div>;
}

function Blob({ top, right, left, bottom, size, c, o }: { top?:string; right?:string; left?:string; bottom?:string; size:number; c:string; o:number }) {
  return <div style={{position:'absolute', top, right, left, bottom, width:size, height:size, borderRadius:999, background:c, opacity:o, filter:'blur(80px)'}}/>;
}
