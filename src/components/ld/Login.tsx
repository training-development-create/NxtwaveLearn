import { useEffect, useRef, useState } from "react";
import { useAuth, ALLOWED_EMAIL_DOMAINS } from "./auth";

export function Login() {
  const { signInWithGoogle, signInWithMicrosoft, authError } = useAuth();
  const [loading, setLoading] = useState<null | 'google' | 'microsoft'>(null);
  const [error, setError] = useState<string | null>(null);

  // OAuth call awaits — if the user closes the popup, denies the prompt, or
  // an auth-state-change tears down this component while we're still
  // awaiting, the post-await setState would leak and React would warn. Gate
  // both setError + setLoading on a mounted ref.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const handle = async (provider: 'google' | 'microsoft') => {
    setError(null);
    setLoading(provider);
    try {
      const { error } = provider === 'google' ? await signInWithGoogle() : await signInWithMicrosoft();
      if (!mountedRef.current) return;
      if (error) {
        setError(error);
        setLoading(null);
      }
      // On success, the OAuth redirect navigates away from the page.
    } catch (e) {
      // Defense in depth — auth.tsx already catches inside signInWithProvider,
      // but if anything slips through we still want the button to recover.
      if (!mountedRef.current) return;
      const msg = e instanceof Error ? e.message : 'Sign-in failed';
      setError(msg);
      setLoading(null);
    }
  };

  const message = error || authError;

  return (
    <div style={{minHeight:'100vh', display:'grid', placeItems:'center', background:'#fff', padding:'24px 16px'}}>
      <div style={{width:'100%', maxWidth:420}}>
        <div style={{display:'grid', placeItems:'center', marginBottom:18}}>
          <img src="/assets/nxtwave-colored.svg" style={{height:36}} alt="NxtWave"/>
        </div>

        <div style={{background:'#fff', border:'1px solid #EEF2F7', borderRadius:16, padding:'26px 22px', boxShadow:'0 10px 28px rgba(0,42,75,.06)'}}>
          <div style={{textAlign:'center', marginBottom:20}}>
            <div style={{fontSize:18, fontWeight:800, color:'#0A1F3D'}}>Sign in to NxtWave Compliance Training</div>
            <div style={{fontSize:13, color:'#5B6A7D', marginTop:6}}>
              Use your {ALLOWED_EMAIL_DOMAINS.map(d => '@' + d).join(' or ')} account
            </div>
          </div>

          <div style={{display:'flex', flexDirection:'column', gap:12}}>
            <button
              onClick={() => handle('google')}
              disabled={loading !== null}
              style={{
                display:'flex', alignItems:'center', justifyContent:'center', gap:10,
                width:'100%', padding:'12px 16px', fontSize:14, fontWeight:700,
                background:'#fff', color:'#3B4A5E',
                border:'1px solid #DDE4ED', borderRadius:10,
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading && loading !== 'google' ? 0.55 : 1,
                transition:'all .15s',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
                <path d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
                <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
                <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
                <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
              </svg>
              {loading === 'google' ? 'Opening Google…' : 'Continue with Google'}
            </button>

            <button
              onClick={() => handle('microsoft')}
              disabled={loading !== null}
              style={{
                display:'flex', alignItems:'center', justifyContent:'center', gap:10,
                width:'100%', padding:'12px 16px', fontSize:14, fontWeight:700,
                background:'#fff', color:'#3B4A5E',
                border:'1px solid #DDE4ED', borderRadius:10,
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading && loading !== 'microsoft' ? 0.55 : 1,
                transition:'all .15s',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg">
                <rect x="1" y="1" width="9" height="9" fill="#F25022"/>
                <rect x="11" y="1" width="9" height="9" fill="#7FBA00"/>
                <rect x="1" y="11" width="9" height="9" fill="#00A4EF"/>
                <rect x="11" y="11" width="9" height="9" fill="#FFB900"/>
              </svg>
              {loading === 'microsoft' ? 'Opening Microsoft…' : 'Continue with Microsoft'}
            </button>
          </div>

          {message && (
            <div style={{marginTop:16, padding:'10px 12px', background:'#FCE1DE', color:'#C2261D', borderRadius:8, fontSize:13, fontWeight:500}}>
              {message}
            </div>
          )}

          <div style={{marginTop:18, fontSize:11, color:'#8A97A8', lineHeight:1.5, textAlign:'center'}}>
            Only {ALLOWED_EMAIL_DOMAINS.map(d => '@' + d).join(' / ')} accounts are permitted. Other accounts will be signed out automatically.
          </div>
        </div>
      </div>
    </div>
  );
}
