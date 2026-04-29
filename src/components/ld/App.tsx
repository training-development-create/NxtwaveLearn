import React, { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Sidebar, Topbar, Icon, Btn, Avatar } from "./ui";
import { Login } from "./Login";
import { Courses } from "./Courses";
import { Player } from "./Player";
import { Assessment } from "./Assessment";
import { AdminAnalytics } from "./AdminAnalytics";
import { AdminUpload } from "./AdminUpload";
import { AdminModules } from "./AdminModules";
import { AdminAdmins } from "./AdminAdmins";
import { AuthProvider, useAuth } from "./auth";

export type AppState = {
  course?: string;
  activeLesson?: string;
  search?: string;
};

export type Nav = (page: string, patch?: Partial<AppState>) => void;

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { err: unknown | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { err: null };
  }
  static getDerivedStateFromError(err: unknown) {
    return { err };
  }
  componentDidCatch(err: unknown) {
    // eslint-disable-next-line no-console
    console.error("App crashed:", err);
  }
  render() {
    if (!this.state.err) return this.props.children;
    const msg =
      this.state.err instanceof Error
        ? `${this.state.err.name}: ${this.state.err.message}\n${this.state.err.stack || ""}`
        : String(this.state.err);
    return (
      <div style={{minHeight:'100vh', background:'#F7F9FC', padding:24}}>
        <div style={{maxWidth:900, margin:'0 auto', background:'#fff', border:'1px solid #FCE1DE', borderRadius:12, padding:18}}>
          <div style={{fontWeight:800, color:'#C2261D', marginBottom:8}}>Something went wrong</div>
          <pre style={{whiteSpace:'pre-wrap', margin:0, fontSize:12, color:'#3B4A5E'}}>{msg}</pre>
        </div>
      </div>
    );
  }
}

function Inner() {
  const { user, profile, role, loading, signOut } = useAuth();
  const [page, setPage] = useState<string>('courses');
  const [state, setState] = useState<AppState>({});

  useEffect(() => {
    if (role === 'admin') setPage(p => (p.startsWith('admin-') ? p : 'admin-analytics'));
    else if (role === 'learner') setPage(() => 'courses');
  }, [role]);

  const nav: Nav = useCallback((p, s) => {
    // Prevent admin sessions from navigating to learner-only pages.
    if (role === 'admin' && !p.startsWith('admin-')) p = 'admin-analytics';
    setPage(p);
    if (s) setState(prev => ({ ...prev, ...s }));
    if (typeof window !== 'undefined') window.scrollTo(0, 0);
  }, [role]);

  if (loading) {
    return <div style={{minHeight:'100vh', display:'grid', placeItems:'center', background:'#F7F9FC', color:'#5B6A7D'}}>Loading…</div>;
  }

  if (!user || !profile || !role) {
    return <Login/>;
  }

  const learnerPages: Record<string, React.ReactNode> = {
    courses: <Courses onNav={nav} initialQuery={state.search}/>,
    player: <Player onNav={nav} state={state} setState={setState}/>,
    assessment: <Assessment onNav={nav} state={state} setState={setState}/>,
  };
  const adminPages: Record<string, React.ReactNode> = {
    'admin-analytics': <AdminAnalytics/>,
    'admin-modules': <AdminModules onNav={nav}/>,
    'admin-upload': <AdminUpload onNav={nav}/>,
    'admin-admins': <AdminAdmins/>,
  };
  const current =
    role === 'admin'
      ? (adminPages[page] ?? adminPages['admin-analytics'])
      : (learnerPages[page] ?? learnerPages.courses);

  const titles: Record<string, [string, string]> = {
    courses: ['My compliance courses', 'All compliance courses available to you'],
    player: ['Now playing', 'Watch the full video to unlock the assessment'],
    assessment: ['Assessment', 'Answer all questions to continue'],
    'admin-analytics': ['Analytics', 'Compliance video watch & assessment activity'],
    'admin-modules': ['Modules', 'Manage all compliance courses & videos'],
    'admin-upload': ['Upload & Assessment', 'Add a new compliance training video and AI-parsed assessment'],
    'admin-admins': ['Admins', 'Promote learners to admin'],
  };
  const fallbackTitleKey =
    role === 'admin'
      ? (titles[page] ? page : 'admin-analytics')
      : (titles[page] ? page : 'courses');
  const [t, s] = titles[fallbackTitleKey] || ['', ''];

  if (role === 'learner') {
    // Back button: where to go from the current page. Courses is the "home"
    // for learners, so it has no back button.
    const backTarget: string | null =
      page === 'assessment' ? 'player' :
      page === 'player' ? 'courses' :
      null;
    return (
      <div style={{minHeight:'100vh', background:'#F7F9FC'}}>
        <header style={{position:'sticky', top:0, zIndex:5, background:'#fff', borderBottom:'1px solid #EEF2F7'}}>
          <div style={{width:'100%', padding:'14px 24px', display:'flex', alignItems:'center', gap:12}}>
            {backTarget && (
              <button
                onClick={() => nav(backTarget)}
                style={{display:'inline-flex', alignItems:'center', gap:6, padding:'6px 12px', background:'#F2F9FF', border:'1px solid #CCEAFF', color:'#0072FF', borderRadius:8, fontSize:13, fontWeight:700, cursor:'pointer'}}
                aria-label="Go back"
              >
                ← Back
              </button>
            )}
            <img src="/assets/nxtwave-colored.svg" style={{height:22}} alt="NxtWave"/>
            <div style={{marginLeft:'auto', display:'flex', alignItems:'center', gap:12}}>
              <div style={{textAlign:'right', minWidth:0, maxWidth:280}}>
                <div title={profile.full_name || profile.email} style={{fontSize:13, fontWeight:700, color:'#0A1F3D', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
                  {profile.full_name || profile.email}
                </div>
                <div style={{fontSize:11, color:'#5B6A7D', display:'flex', gap:8, justifyContent:'flex-end', alignItems:'center'}}>
                  <span title={profile.email} style={{overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:200}}>{profile.email}</span>
                  {profile.employee_id && (
                    <code style={{fontSize:10, background:'#F2F9FF', padding:'2px 6px', borderRadius:4, color:'#0072FF', fontWeight:700}}>{profile.employee_id}</code>
                  )}
                </div>
              </div>
              <Avatar src={profile.avatar_url} name={profile.full_name || profile.email} size={34}/>
              <Btn variant="ghost" size="sm" onClick={async ()=>{ await signOut(); }}>Sign out</Btn>
            </div>
          </div>
        </header>
        <div style={{width:'100%', padding:'0 24px'}}>
          <ErrorBoundary>{current}</ErrorBoundary>
        </div>
      </div>
    );
  }

  return (
    <div style={{display:'flex', minHeight:'100vh', background:'#F7F9FC'}}>
      <Sidebar
        role={role}
        active={page}
        profile={profile}
        onNav={async (id) => {
          if (id === 'logout') { await signOut(); return; }
          setPage(id);
        }}
      />
      <main style={{flex:1, background:'#F7F9FC', minWidth:0}}>
        <Topbar
          title={t}
          subtitle={s}
          profile={profile}
          onBack={page !== 'admin-analytics' ? () => nav('admin-analytics') : undefined}
        >
          {null}
        </Topbar>
        <ErrorBoundary>{current}</ErrorBoundary>
      </main>
    </div>
  );
}

export function LDApp() {
  void supabase;
  return <AuthProvider><Inner/></AuthProvider>;
}
