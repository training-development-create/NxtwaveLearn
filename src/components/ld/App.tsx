import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Sidebar, Topbar, Icon } from "./ui";
import { Login } from "./Login";
import { Dashboard } from "./Dashboard";
import { Courses } from "./Courses";
import { Player } from "./Player";
import { Assessment } from "./Assessment";
import { ProgressPage } from "./Progress";
import { AdminDashboard } from "./AdminDashboard";
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

function Inner() {
  const { user, profile, role, loading, signOut } = useAuth();
  const [page, setPage] = useState<string>('dashboard');
  const [state, setState] = useState<AppState>({});

  useEffect(() => {
    if (role === 'admin') setPage(p => (p.startsWith('admin-') ? p : 'admin-dashboard'));
    else if (role === 'learner') setPage(p => (p.startsWith('admin-') ? 'dashboard' : p));
  }, [role]);

  const nav: Nav = useCallback((p, s) => {
    setPage(p);
    if (s) setState(prev => ({ ...prev, ...s }));
    if (typeof window !== 'undefined') window.scrollTo(0, 0);
  }, []);

  if (loading) {
    return <div style={{minHeight:'100vh', display:'grid', placeItems:'center', background:'#F7F9FC', color:'#5B6A7D'}}>Loading…</div>;
  }

  if (!user || !profile || !role) {
    return <Login/>;
  }

  const learnerPages: Record<string, React.ReactNode> = {
    dashboard: <Dashboard onNav={nav}/>,
    courses: <Courses onNav={nav} initialQuery={state.search}/>,
    player: <Player onNav={nav} state={state} setState={setState}/>,
    assessment: <Assessment onNav={nav} state={state} setState={setState}/>,
    progress: <ProgressPage/>,
  };
  const adminPages: Record<string, React.ReactNode> = {
    'admin-dashboard': <AdminDashboard onNav={nav}/>,
    'admin-analytics': <AdminAnalytics/>,
    'admin-modules': <AdminModules onNav={nav}/>,
    'admin-upload': <AdminUpload onNav={nav}/>,
    'admin-admins': <AdminAdmins/>,
  };
  const current = role === 'admin' ? adminPages[page] : learnerPages[page];

  const titles: Record<string, [string, string]> = {
    dashboard: ['Home', 'Your assigned training and progress'],
    courses: ['My courses', 'All courses available to you'],
    player: ['Now playing', 'Watch the full video to unlock the quiz'],
    assessment: ['Assessment', 'Answer all questions to continue'],
    progress: ['My progress', 'Completion history'],
    'admin-dashboard': ['Overview', 'Platform health at a glance'],
    'admin-analytics': ['Analytics', 'Watch duration and engagement per learner'],
    'admin-modules': ['Modules', 'Manage all courses & videos'],
    'admin-upload': ['Upload & Quiz', 'Add a new training video and AI-parsed assessment'],
    'admin-admins': ['Admins', 'Promote learners to admin'],
  };
  const [t, s] = titles[page] || ['', ''];

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
        <Topbar title={t} subtitle={s} profile={profile}>
          {page === 'dashboard' && (
            <form onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); const q = String(fd.get('q') || '').trim(); nav('courses', { search: q }); }} style={{position:'relative'}}>
              <input name="q" placeholder="Search courses…" style={{padding:'10px 14px 10px 38px', border:'1px solid #DDE4ED', borderRadius:10, fontSize:13, width:320, outline:'none', background:'#F7F9FC'}}/>
              <div style={{position:'absolute', left:12, top:12, color:'#8A97A8', pointerEvents:'none'}}><Icon d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" size={14}/></div>
            </form>
          )}
        </Topbar>
        {current}
      </main>
    </div>
  );
}

export function LDApp() {
  void supabase;
  return <AuthProvider><Inner/></AuthProvider>;
}
